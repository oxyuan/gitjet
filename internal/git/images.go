package git

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ImageData is a file's bytes, ready for an <img> element.
type ImageData struct {
	Mime string `json:"mime"`
	Data string `json:"data"`
}

// imageMime maps the extensions a diff viewer can draw to their media type.
func imageMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	}
	return ""
}

// Image reads one version of an image file: "" is the working tree,
// "INDEX" the staged copy, anything else a revision.
func (r *Repo) Image(ctx context.Context, path, revision string) (ImageData, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return ImageData{}, err
	}
	mime := imageMime(clean)
	if mime == "" {
		return ImageData{}, errors.New("not an image this viewer can show")
	}
	rev := strings.TrimSpace(revision)
	if rev != "" && rev != "INDEX" {
		if strings.ContainsAny(rev, " \t\n") || strings.HasPrefix(rev, "-") {
			return ImageData{}, errors.New("invalid revision")
		}
	}
	var data []byte
	switch rev {
	case "":
		data, err = os.ReadFile(r.AbsPath(clean))
	case "INDEX":
		var text string
		text, err = r.run(ctx, "show", ":"+clean)
		data = []byte(text)
	default:
		var text string
		text, err = r.run(ctx, "show", rev+":"+clean)
		data = []byte(text)
	}
	if err != nil {
		return ImageData{},
			// A missing file is a valid side of a diff: the caller draws
			// the empty state.
			err
	}
	if len(data) > 20<<20 {
		return ImageData{}, errors.New("the image is larger than 20 MB")
	}
	return ImageData{Mime: mime, Data: base64.StdEncoding.EncodeToString(data)}, nil
}
