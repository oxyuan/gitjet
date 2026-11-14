package lang

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"gitjet/internal/proc"
)

// installRecord is what an installed pack remembers: the version and the
// executable relative to the pack's directory, so the directory can move.
type installRecord struct {
	Version    string `json:"version"`
	Executable string `json:"executable"`
}

// Installer owns the managed language-pack directory. Servers installed here
// belong to the app; the user's PATH and package manager installs are only
// ever read.
type Installer struct {
	dir string
}

// NewInstaller names the directory managed packs live in. An empty path
// disables managed installs; the catalog still detects PATH and custom
// commands.
func NewInstaller(dir string) *Installer { return &Installer{dir: dir} }

func (i *Installer) packDir(pack Pack) string { return filepath.Join(i.dir, pack.ID) }

func (i *Installer) recordPath(pack Pack) string {
	return filepath.Join(i.packDir(pack), "install.json")
}

func (i *Installer) readRecord(pack Pack) (installRecord, bool) {
	b, err := os.ReadFile(i.recordPath(pack))
	if err != nil {
		return installRecord{}, false
	}
	var record installRecord
	if json.Unmarshal(b, &record) != nil || record.Executable == "" {
		return installRecord{}, false
	}
	return record, true
}

// Command reports the managed executable for a pack, and the installed
// version. An empty command means nothing managed is installed.
func (i *Installer) Command(pack Pack) (string, string) {
	if i.dir == "" {
		return "", ""
	}
	record, ok := i.readRecord(pack)
	if !ok {
		return "", ""
	}
	path := filepath.Join(i.packDir(pack), filepath.FromSlash(record.Executable))
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		return path, record.Version
	}
	return "", ""
}

// installMu serializes installs: two clicks must not write the same final
// directory at once.
var installMu sync.Mutex

// Install downloads or builds the pack's server into the managed directory
// and reports progress lines. It returns the installed version.
func (i *Installer) Install(pack Pack, report func(string)) (string, error) {
	if pack.Install == nil || pack.Install.Kind == "" {
		return "", fmt.Errorf("%s has no automatic installer", pack.Name)
	}
	if i.dir == "" {
		return "", errors.New("the language-pack directory is not configured")
	}
	installMu.Lock()
	defer installMu.Unlock()
	if err := os.MkdirAll(i.dir, 0o755); err != nil {
		return "", err
	}
	var version string
	var err error
	switch pack.Install.Kind {
	case "go":
		version, err = i.installGo(pack, report)
	case "archive":
		version, err = i.installArchive(pack, report)
	default:
		return "", fmt.Errorf("unknown installer %q for %s", pack.Install.Kind, pack.Name)
	}
	if err != nil {
		return "", err
	}
	return version, nil
}

func (i *Installer) installGo(pack Pack, report func(string)) (string, error) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		return "", errors.New("the Go toolchain is not on PATH")
	}
	tmp, err := os.MkdirTemp(i.dir, ".go-install-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	progress("Building "+pack.ServerName+" with the Go toolchain", report)
	cmd := exec.Command(goBin, "install", pack.Install.Package)
	cmd.Dir = i.dir
	cmd.Env = append(os.Environ(), "GOBIN="+tmp)
	proc.HideConsole(cmd)
	out, runErr := cmd.CombinedOutput()
	if text := strings.TrimSpace(string(out)); text != "" {
		for _, line := range strings.Split(text, "\n") {
			report(line)
		}
	}
	if runErr != nil {
		return "", fmt.Errorf("go install %s: %w", pack.Install.Package, runErr)
	}
	name := pack.ServerName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join(tmp, name)
	if st, err := os.Stat(binary); err != nil || st.IsDir() {
		return "", fmt.Errorf("go install finished but %s is missing", name)
	}
	return i.commit(pack, tmp, name, pack.Install.Version, report)
}

// commit replaces the pack directory with a finished staging directory.
func (i *Installer) commit(pack Pack, staging, executable, version string, report func(string)) (string, error) {
	final := i.packDir(pack)
	if err := os.RemoveAll(final); err != nil {
		return "", err
	}
	if err := os.Rename(staging, final); err != nil {
		return "", err
	}
	record := installRecord{Version: version, Executable: filepath.ToSlash(executable)}
	if err := writeRecord(i.recordPath(pack), record); err != nil {
		os.RemoveAll(final)
		return "", err
	}
	progress("Installed "+pack.ServerName+" "+version, report)
	return version, nil
}

func (i *Installer) installArchive(pack Pack, report func(string)) (string, error) {
	if pack.Install.URL == "" {
		return "", errors.New("the pack has no download URL")
	}
	if pack.Install.RequiresJava {
		if err := checkJava(); err != nil {
			return "", err
		}
	}
	tmp, err := os.MkdirTemp(i.dir, ".archive-install-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)

	progress("Downloading "+pack.ServerName+" "+pack.Install.Version, report)
	archive := filepath.Join(tmp, "download.tar.gz")
	if err := download(pack.Install.URL, archive, pack.Install.SHA256, report); err != nil {
		return "", err
	}
	progress("Extracting "+filepath.Base(pack.Install.URL), report)
	root := filepath.Join(tmp, "files")
	if err := extractTarGz(archive, root); err != nil {
		return "", err
	}
	executable, err := findExecutable(root, pack.Install.Executables)
	if err != nil {
		return "", err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(filepath.Join(root, executable), 0o755); err != nil {
			return "", err
		}
	}
	return i.commit(pack, root, executable, pack.Install.Version, report)
}

// findExecutable picks the first candidate that exists, preferring the
// platform's launcher (bin/jdtls.bat on Windows).
// checkJava refuses an install that could only fail at startup: jdtls needs
// a JDK 21 or newer on PATH or in JAVA_HOME.
func checkJava() error {
	command := ""
	if home := strings.TrimSpace(os.Getenv("JAVA_HOME")); home != "" {
		candidate := filepath.Join(home, "bin", "java")
		if runtime.GOOS == "windows" {
			candidate += ".exe"
		}
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			command = candidate
		}
	}
	if command == "" {
		if path, err := exec.LookPath("java"); err == nil {
			command = path
		}
	}
	if command == "" {
		return errors.New("Java 21 or newer is required: put java on PATH or set JAVA_HOME")
	}
	out, err := exec.Command(command, "-version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("java -version: %w", err)
	}
	major, ok := javaMajor(string(out))
	if !ok || major < 21 {
		return errors.New("Java 21 or newer is required by the Eclipse JDT Language Server")
	}
	return nil
}

// javaMajor reads the first version number from `java -version` output:
// "25.0.5" is 25, and the old "1.8.0_202" spelling is 8.
func javaMajor(output string) (int, bool) {
	for _, line := range strings.Split(output, "\n") {
		start := strings.IndexByte(line, '"')
		if start < 0 {
			continue
		}
		rest := line[start+1:]
		end := strings.IndexByte(rest, '"')
		if end < 0 {
			continue
		}
		version := rest[:end]
		parts := strings.Split(version, ".")
		if len(parts) >= 2 && parts[0] == "1" {
			var major int
			if _, err := fmt.Sscanf(parts[1], "%d", &major); err == nil {
				return major, true
			}
			continue
		}
		var major int
		if _, err := fmt.Sscanf(parts[0], "%d", &major); err == nil {
			return major, true
		}
	}
	return 0, false
}

func findExecutable(root string, candidates []string) (string, error) {
	try := func(name string) (string, bool) {
		path := filepath.Join(root, filepath.FromSlash(name))
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			return name, true
		}
		return "", false
	}
	if runtime.GOOS == "windows" {
		for _, name := range candidates {
			if strings.HasSuffix(strings.ToLower(name), ".bat") || strings.HasSuffix(strings.ToLower(name), ".cmd") {
				if found, ok := try(name); ok {
					return found, nil
				}
			}
		}
	}
	for _, name := range candidates {
		if found, ok := try(name); ok {
			return found, nil
		}
	}
	return "", errors.New("the archive does not contain the server executable")
}

func download(url, dest, expected string, report func(string)) error {
	client := &http.Client{Timeout: 20 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: %s", url, resp.Status)
	}
	const maxSize = 512 << 20
	if resp.ContentLength > maxSize {
		return fmt.Errorf("download is larger than %d MiB", maxSize>>20)
	}
	file, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	total := resp.ContentLength
	read := int64(0)
	lastReport := int64(0)
	buf := make([]byte, 64<<10)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			read += int64(n)
			if read > maxSize {
				return fmt.Errorf("download exceeded %d MiB", maxSize>>20)
			}
			if _, err := file.Write(buf[:n]); err != nil {
				return err
			}
			hash.Write(buf[:n])
			if total > 0 && read-lastReport >= 5<<20 {
				lastReport = read
				progress(fmt.Sprintf("Downloaded %d%% (%d MiB)", read*100/total, read>>20), report)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if total > 0 {
		progress(fmt.Sprintf("Downloaded %d%% (%d MiB)", int64(100), read>>20), report)
	}
	sum := hex.EncodeToString(hash.Sum(nil))
	if expected != "" && !strings.EqualFold(sum, expected) {
		return fmt.Errorf("checksum mismatch: got %s, want %s", sum, expected)
	}
	if expected == "" {
		progress("SHA-256 "+sum, report)
	}
	return nil
}

// extractTarGz unpacks a tar.gz below dest, refusing entries that escape it.
func extractTarGz(archive, dest string) error {
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	cleanDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	tarReader := tar.NewReader(gz)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if header.Name == "" {
			continue
		}
		rel := filepath.FromSlash(header.Name)
		if filepath.IsAbs(rel) {
			return fmt.Errorf("archive entry is absolute: %s", header.Name)
		}
		target := filepath.Join(cleanDest, rel)
		if target != cleanDest && !strings.HasPrefix(target, cleanDest+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes its directory: %s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if header.Size < 0 || header.Size > 1<<30 {
				return fmt.Errorf("archive entry is too large: %s", header.Name)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if header.Mode&0o111 != 0 {
				mode = 0o755
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			if _, err := io.CopyN(out, tarReader, header.Size); err != nil {
				out.Close()
				return err
			}
			if err := out.Close(); err != nil {
				return err
			}
		case tar.TypeSymlink, tar.TypeLink:
			// The servers GitJet installs are plain files; a link could
			// point outside the managed directory, so it is not unpacked.
			continue
		default:
			continue
		}
	}
	return nil
}

func writeRecord(path string, record installRecord) error {
	b, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".install-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

// Remove deletes a managed install. PATH and custom commands are untouched.
func (i *Installer) Remove(pack Pack) error {
	if i.dir == "" {
		return nil
	}
	installMu.Lock()
	defer installMu.Unlock()
	return os.RemoveAll(i.packDir(pack))
}

func progress(line string, report func(string)) {
	if report != nil && line != "" {
		report(line)
	}
}
