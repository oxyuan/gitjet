package app

import (
	"strings"

	"github.com/egoist/mygo/ui"
)

// Generated from the React page's src/fileIcons.ts and style.css. Keep the
// tables in step with those files rather than adding one-off extensions.

type fileBadgeDef struct {
	Label string
	Lang  string
}

var fileBadgesByName = map[string]fileBadgeDef{
	"dockerfile":          {Label: "DK", Lang: "docker"},
	"docker-compose.yml":  {Label: "DK", Lang: "docker"},
	"docker-compose.yaml": {Label: "DK", Lang: "docker"},
	"makefile":            {Label: "MK", Lang: "make"},
	"gnumakefile":         {Label: "MK", Lang: "make"},
	"cmakelists.txt":      {Label: "CM", Lang: "cmake"},
	"package.json":        {Label: "NP", Lang: "npm"},
	"package-lock.json":   {Label: "LK", Lang: "lock"},
	"pnpm-lock.yaml":      {Label: "LK", Lang: "lock"},
	"yarn.lock":           {Label: "LK", Lang: "lock"},
	"bun.lockb":           {Label: "LK", Lang: "lock"},
	"go.mod":              {Label: "GO", Lang: "go"},
	"go.sum":              {Label: "GO", Lang: "go"},
	"go.work":             {Label: "GO", Lang: "go"},
	"cargo.toml":          {Label: "RS", Lang: "rust"},
	"cargo.lock":          {Label: "LK", Lang: "lock"},
	"pom.xml":             {Label: "MV", Lang: "maven"},
	"build.gradle":        {Label: "GR", Lang: "gradle"},
	"build.gradle.kts":    {Label: "GR", Lang: "gradle"},
	"settings.gradle":     {Label: "GR", Lang: "gradle"},
	"settings.gradle.kts": {Label: "GR", Lang: "gradle"},
	"gradlew":             {Label: "GR", Lang: "gradle"},
	"gradlew.bat":         {Label: "GR", Lang: "gradle"},
	"mvnw":                {Label: "MV", Lang: "maven"},
	"mvnw.cmd":            {Label: "MV", Lang: "maven"},
	"requirements.txt":    {Label: "PY", Lang: "python"},
	"pyproject.toml":      {Label: "PY", Lang: "python"},
	"pipfile":             {Label: "PY", Lang: "python"},
	"gemfile":             {Label: "RB", Lang: "ruby"},
	"rakefile":            {Label: "RB", Lang: "ruby"},
	"composer.json":       {Label: "PHP", Lang: "php"},
	"composer.lock":       {Label: "LK", Lang: "lock"},
	"tsconfig.json":       {Label: "TS", Lang: "ts"},
	"jsconfig.json":       {Label: "JS", Lang: "js"},
	"vite.config.ts":      {Label: "TS", Lang: "ts"},
	"webpack.config.js":   {Label: "JS", Lang: "js"},
	".gitignore":          {Label: "GIT", Lang: "git"},
	".gitattributes":      {Label: "GIT", Lang: "git"},
	".gitmodules":         {Label: "GIT", Lang: "git"},
	".gitconfig":          {Label: "GIT", Lang: "git"},
	".editorconfig":       {Label: "CFG", Lang: "config"},
	".npmrc":              {Label: "CFG", Lang: "config"},
	".nvmrc":              {Label: "CFG", Lang: "config"},
	".prettierrc":         {Label: "CFG", Lang: "config"},
	".eslintrc":           {Label: "CFG", Lang: "config"},
	".babelrc":            {Label: "CFG", Lang: "config"},
	"license":             {Label: "LC", Lang: "text"},
	"licence":             {Label: "LC", Lang: "text"},
	"copying":             {Label: "LC", Lang: "text"},
	"notice":              {Label: "LC", Lang: "text"},
	"authors":             {Label: "AU", Lang: "text"},
	"readme":              {Label: "MD", Lang: "markdown"},
	"readme.md":           {Label: "MD", Lang: "markdown"},
	"readme.markdown":     {Label: "MD", Lang: "markdown"},
	"readme.txt":          {Label: "MD", Lang: "markdown"},
}

var fileBadgesByExt = map[string]fileBadgeDef{
	"ts":         {Label: "TS", Lang: "ts"},
	"mts":        {Label: "TS", Lang: "ts"},
	"cts":        {Label: "TS", Lang: "ts"},
	"tsx":        {Label: "TS", Lang: "ts"},
	"js":         {Label: "JS", Lang: "js"},
	"mjs":        {Label: "JS", Lang: "js"},
	"cjs":        {Label: "JS", Lang: "js"},
	"jsx":        {Label: "JS", Lang: "js"},
	"go":         {Label: "GO", Lang: "go"},
	"java":       {Label: "JV", Lang: "java"},
	"jar":        {Label: "JV", Lang: "java"},
	"class":      {Label: "JV", Lang: "java"},
	"kt":         {Label: "KT", Lang: "kotlin"},
	"kts":        {Label: "KT", Lang: "kotlin"},
	"groovy":     {Label: "GR", Lang: "gradle"},
	"gradle":     {Label: "GR", Lang: "gradle"},
	"scala":      {Label: "SC", Lang: "scala"},
	"sc":         {Label: "SC", Lang: "scala"},
	"rs":         {Label: "RS", Lang: "rust"},
	"py":         {Label: "PY", Lang: "python"},
	"pyi":        {Label: "PY", Lang: "python"},
	"pyw":        {Label: "PY", Lang: "python"},
	"rb":         {Label: "RB", Lang: "ruby"},
	"rake":       {Label: "RB", Lang: "ruby"},
	"php":        {Label: "PHP", Lang: "php"},
	"c":          {Label: "C", Lang: "c"},
	"h":          {Label: "C", Lang: "c"},
	"cpp":        {Label: "C+", Lang: "cpp"},
	"cc":         {Label: "C+", Lang: "cpp"},
	"cxx":        {Label: "C+", Lang: "cpp"},
	"c++":        {Label: "C+", Lang: "cpp"},
	"hpp":        {Label: "C+", Lang: "cpp"},
	"hh":         {Label: "C+", Lang: "cpp"},
	"hxx":        {Label: "C+", Lang: "cpp"},
	"ipp":        {Label: "C+", Lang: "cpp"},
	"cs":         {Label: "C#", Lang: "csharp"},
	"csx":        {Label: "C#", Lang: "csharp"},
	"fs":         {Label: "F#", Lang: "fsharp"},
	"fsx":        {Label: "F#", Lang: "fsharp"},
	"vb":         {Label: "VB", Lang: "vb"},
	"swift":      {Label: "SW", Lang: "swift"},
	"m":          {Label: "OC", Lang: "objc"},
	"mm":         {Label: "OC", Lang: "objc"},
	"sh":         {Label: "SH", Lang: "shell"},
	"bash":       {Label: "SH", Lang: "shell"},
	"zsh":        {Label: "SH", Lang: "shell"},
	"fish":       {Label: "SH", Lang: "shell"},
	"ksh":        {Label: "SH", Lang: "shell"},
	"ps1":        {Label: "PS", Lang: "shell"},
	"psm1":       {Label: "PS", Lang: "shell"},
	"bat":        {Label: "CMD", Lang: "shell"},
	"cmd":        {Label: "CMD", Lang: "shell"},
	"html":       {Label: "<>", Lang: "html"},
	"htm":        {Label: "<>", Lang: "html"},
	"xhtml":      {Label: "<>", Lang: "html"},
	"xml":        {Label: "<>", Lang: "xml"},
	"svg":        {Label: "SVG", Lang: "xml"},
	"css":        {Label: "#", Lang: "css"},
	"scss":       {Label: "#", Lang: "scss"},
	"sass":       {Label: "#", Lang: "scss"},
	"less":       {Label: "#", Lang: "less"},
	"styl":       {Label: "#", Lang: "stylus"},
	"json":       {Label: "{}", Lang: "json"},
	"jsonc":      {Label: "{}", Lang: "json"},
	"json5":      {Label: "{}", Lang: "json"},
	"jsonl":      {Label: "{}", Lang: "json"},
	"ndjson":     {Label: "{}", Lang: "json"},
	"yaml":       {Label: "Y", Lang: "yaml"},
	"yml":        {Label: "Y", Lang: "yaml"},
	"toml":       {Label: "TM", Lang: "toml"},
	"md":         {Label: "MD", Lang: "markdown"},
	"markdown":   {Label: "MD", Lang: "markdown"},
	"mdx":        {Label: "MD", Lang: "markdown"},
	"rst":        {Label: "R", Lang: "text"},
	"txt":        {Label: "TX", Lang: "text"},
	"log":        {Label: "TX", Lang: "text"},
	"sql":        {Label: "DB", Lang: "sql"},
	"sqlite":     {Label: "DB", Lang: "sql"},
	"sqlite3":    {Label: "DB", Lang: "sql"},
	"graphql":    {Label: "GQ", Lang: "graphql"},
	"gql":        {Label: "GQ", Lang: "graphql"},
	"proto":      {Label: "PB", Lang: "proto"},
	"lua":        {Label: "L", Lang: "lua"},
	"dart":       {Label: "D", Lang: "dart"},
	"vue":        {Label: "V", Lang: "vue"},
	"svelte":     {Label: "S", Lang: "svelte"},
	"astro":      {Label: "A", Lang: "astro"},
	"elm":        {Label: "EL", Lang: "elm"},
	"ex":         {Label: "EX", Lang: "elixir"},
	"exs":        {Label: "EX", Lang: "elixir"},
	"erl":        {Label: "ER", Lang: "erlang"},
	"hrl":        {Label: "ER", Lang: "erlang"},
	"hs":         {Label: "HS", Lang: "haskell"},
	"lhs":        {Label: "HS", Lang: "haskell"},
	"clj":        {Label: "CL", Lang: "clojure"},
	"cljs":       {Label: "CL", Lang: "clojure"},
	"cljc":       {Label: "CL", Lang: "clojure"},
	"edn":        {Label: "CL", Lang: "clojure"},
	"r":          {Label: "R", Lang: "r"},
	"jl":         {Label: "JL", Lang: "julia"},
	"pl":         {Label: "PL", Lang: "perl"},
	"pm":         {Label: "PL", Lang: "perl"},
	"nim":        {Label: "NM", Lang: "nim"},
	"zig":        {Label: "Z", Lang: "zig"},
	"v":          {Label: "V", Lang: "verilog"},
	"asm":        {Label: "AS", Lang: "asm"},
	"s":          {Label: "AS", Lang: "asm"},
	"nasm":       {Label: "AS", Lang: "asm"},
	"tf":         {Label: "TF", Lang: "terraform"},
	"tfvars":     {Label: "TF", Lang: "terraform"},
	"hcl":        {Label: "HC", Lang: "terraform"},
	"nix":        {Label: "NX", Lang: "nix"},
	"tex":        {Label: "TX", Lang: "tex"},
	"sty":        {Label: "TX", Lang: "tex"},
	"cls":        {Label: "TX", Lang: "tex"},
	"csv":        {Label: "TB", Lang: "data"},
	"tsv":        {Label: "TB", Lang: "data"},
	"ipynb":      {Label: "NB", Lang: "python"},
	"cfg":        {Label: "CFG", Lang: "config"},
	"conf":       {Label: "CFG", Lang: "config"},
	"ini":        {Label: "CFG", Lang: "config"},
	"properties": {Label: "CFG", Lang: "config"},
	"env":        {Label: "ENV", Lang: "config"},
	"lock":       {Label: "LK", Lang: "lock"},
	"pem":        {Label: "KEY", Lang: "key"},
	"crt":        {Label: "KEY", Lang: "key"},
	"key":        {Label: "KEY", Lang: "key"},
	"p12":        {Label: "KEY", Lang: "key"},
	"pfx":        {Label: "KEY", Lang: "key"},
	"png":        {Label: "IMG", Lang: "image"},
	"jpg":        {Label: "IMG", Lang: "image"},
	"jpeg":       {Label: "IMG", Lang: "image"},
	"gif":        {Label: "IMG", Lang: "image"},
	"webp":       {Label: "IMG", Lang: "image"},
	"bmp":        {Label: "IMG", Lang: "image"},
	"ico":        {Label: "IMG", Lang: "image"},
	"tif":        {Label: "IMG", Lang: "image"},
	"tiff":       {Label: "IMG", Lang: "image"},
	"avif":       {Label: "IMG", Lang: "image"},
	"pdf":        {Label: "PDF", Lang: "pdf"},
	"zip":        {Label: "ZIP", Lang: "archive"},
	"tar":        {Label: "ZIP", Lang: "archive"},
	"gz":         {Label: "ZIP", Lang: "archive"},
	"tgz":        {Label: "ZIP", Lang: "archive"},
	"bz2":        {Label: "ZIP", Lang: "archive"},
	"xz":         {Label: "ZIP", Lang: "archive"},
	"7z":         {Label: "ZIP", Lang: "archive"},
	"rar":        {Label: "ZIP", Lang: "archive"},
	"zst":        {Label: "ZIP", Lang: "archive"},
	"mp4":        {Label: "AV", Lang: "media"},
	"mov":        {Label: "AV", Lang: "media"},
	"webm":       {Label: "AV", Lang: "media"},
	"avi":        {Label: "AV", Lang: "media"},
	"mkv":        {Label: "AV", Lang: "media"},
	"mp3":        {Label: "AV", Lang: "media"},
	"wav":        {Label: "AV", Lang: "media"},
	"flac":       {Label: "AV", Lang: "media"},
	"ogg":        {Label: "AV", Lang: "media"},
	"m4a":        {Label: "AV", Lang: "media"},
	"woff":       {Label: "FN", Lang: "font"},
	"woff2":      {Label: "FN", Lang: "font"},
	"ttf":        {Label: "FN", Lang: "font"},
	"otf":        {Label: "FN", Lang: "font"},
	"eot":        {Label: "FN", Lang: "font"},
	"wasm":       {Label: "WA", Lang: "binary"},
	"o":          {Label: "BIN", Lang: "binary"},
	"a":          {Label: "BIN", Lang: "binary"},
	"so":         {Label: "BIN", Lang: "binary"},
	"dylib":      {Label: "BIN", Lang: "binary"},
	"dll":        {Label: "BIN", Lang: "binary"},
	"exe":        {Label: "BIN", Lang: "binary"},
	"bin":        {Label: "BIN", Lang: "binary"},
	"plist":      {Label: "PL", Lang: "config"},
}

var fileBadgeColors = map[string]ui.Color{
	"archive":   ui.Hex("#b8863b"),
	"asm":       ui.Hex("#8a8f98"),
	"astro":     ui.Hex("#b06ad0"),
	"binary":    ui.Hex("#8a8f98"),
	"c":         ui.Hex("#5f7ed6"),
	"clojure":   ui.Hex("#d06a5a"),
	"cmake":     ui.Hex("#4a7ab8"),
	"config":    ui.Hex("#8a8f98"),
	"cpp":       ui.Hex("#3b82c4"),
	"csharp":    ui.Hex("#a855c9"),
	"css":       ui.Hex("#4f7de0"),
	"dart":      ui.Hex("#2b9bd0"),
	"data":      ui.Hex("#6a9a5a"),
	"docker":    ui.Hex("#2f9bdb"),
	"elixir":    ui.Hex("#9a6a86"),
	"elm":       ui.Hex("#5a9fd4"),
	"erlang":    ui.Hex("#b34a63"),
	"font":      ui.Hex("#8a8f98"),
	"fsharp":    ui.Hex("#378bba"),
	"git":       ui.Hex("#dc6a4a"),
	"go":        ui.Hex("#33a9cd"),
	"gradle":    ui.Hex("#4a9bb8"),
	"graphql":   ui.Hex("#d84a9b"),
	"haskell":   ui.Hex("#7d6aa8"),
	"html":      ui.Hex("#e06138"),
	"image":     ui.Hex("#5f9e4a"),
	"java":      ui.Hex("#d9803a"),
	"js":        ui.Hex("#c9a227"),
	"json":      ui.Hex("#b8a12a"),
	"julia":     ui.Hex("#9558b2"),
	"key":       ui.Hex("#c9a227"),
	"kotlin":    ui.Hex("#8b6fe8"),
	"less":      ui.Hex("#5a7fc4"),
	"lock":      ui.Hex("#8a8f98"),
	"lua":       ui.Hex("#5b6ac9"),
	"make":      ui.Hex("#8a8f98"),
	"markdown":  ui.Hex("#5a9fd4"),
	"maven":     ui.Hex("#c96a4a"),
	"media":     ui.Hex("#b06a9a"),
	"nim":       ui.Hex("#b89a2a"),
	"nix":       ui.Hex("#7e7eff"),
	"npm":       ui.Hex("#cb3837"),
	"objc":      ui.Hex("#438eff"),
	"pdf":       ui.Hex("#d05a4a"),
	"perl":      ui.Hex("#4b9fb8"),
	"php":       ui.Hex("#8b7bd8"),
	"proto":     ui.Hex("#4a89d6"),
	"python":    ui.Hex("#4b8bbe"),
	"r":         ui.Hex("#4b7fc4"),
	"ruby":      ui.Hex("#d04545"),
	"rust":      ui.Hex("#c97a4a"),
	"scala":     ui.Hex("#c44a5a"),
	"scss":      ui.Hex("#cf6aa0"),
	"shell":     ui.Hex("#4fa83d"),
	"sql":       ui.Hex("#d08a2a"),
	"stylus":    ui.Hex("#8aa84a"),
	"svelte":    ui.Hex("#e85c2c"),
	"swift":     ui.Hex("#e8663d"),
	"terraform": ui.Hex("#8b63c8"),
	"tex":       ui.Hex("#6a8a3a"),
	"text":      ui.Hex("#8a8f98"),
	"toml":      ui.Hex("#b06b4c"),
	"ts":        ui.Hex("#4a90d9"),
	"vb":        ui.Hex("#945db7"),
	"verilog":   ui.Hex("#6a7fc4"),
	"vue":       ui.Hex("#3fae83"),
	"xml":       ui.Hex("#e08a3a"),
	"yaml":      ui.Hex("#cc5252"),
	"zig":       ui.Hex("#e08a3a"),
}

// fileBadge names the language of a repository path, exactly as the React
// page's fileIcons.ts does: whole names win over extensions, dotfiles fall
// through to their second component, and an unknown extension becomes a
// two-letter monogram rather than the same sheet as every other file.
func fileBadge(path string) (label, lang string) {
	base := path
	if i := strings.LastIndexByte(base, '/'); i >= 0 {
		base = base[i+1:]
	}
	base = strings.ToLower(base)
	if base == "" {
		return "", "plain"
	}
	if named, ok := fileBadgesByName[base]; ok {
		return named.Label, named.Lang
	}
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return "ENV", "config"
	}
	if strings.HasPrefix(base, ".") {
		second := strings.IndexByte(base[1:], '.')
		if second < 0 {
			return "CFG", "config"
		}
		ext := base[second+2:]
		if def, ok := fileBadgesByExt[ext]; ok {
			return def.Label, def.Lang
		}
		return "CFG", "config"
	}
	if dot := strings.LastIndexByte(base, '.'); dot > 0 {
		ext := base[dot+1:]
		if ext != "" {
			if def, ok := fileBadgesByExt[ext]; ok {
				return def.Label, def.Lang
			}
			return monogram(ext), "plain"
		}
	}
	return monogram(base), "plain"
}

func monogram(word string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(word) {
		if r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	letters := b.String()
	if len(letters) <= 1 {
		return letters
	}
	return letters[:2]
}

func fileBadgeTint(lang string, p appColors) ui.Color {
	if c, ok := fileBadgeColors[lang]; ok {
		return c
	}
	if lang == "plain" {
		return ui.Hex(p.muted)
	}
	return ui.Hex(p.muted2)
}
