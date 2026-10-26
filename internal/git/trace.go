package git

import (
	"context"
	"strings"
)

// traceKey marks a context whose git invocations are recorded, so the app
// can show the user the command behind an action, the way an IDE's "Show
// Git Command" does.
type traceKey struct{}

// WithCommandTrace returns a context that records the git commands run
// under it, and the slice they are appended to as printable lines.
func WithCommandTrace(ctx context.Context) (context.Context, *[]string) {
	out := &[]string{}
	return context.WithValue(ctx, traceKey{}, out), out
}

// Commands renders recorded commands as the lines the app shows.
func Commands(recorded *[]string) []string {
	if recorded == nil {
		return nil
	}
	return *recorded
}

func recordCommand(ctx context.Context, args []string) {
	out, ok := ctx.Value(traceKey{}).(*[]string)
	if !ok || len(args) == 0 {
		return
	}
	quoted := make([]string, 0, len(args))
	for _, a := range args {
		quoted = append(quoted, quoteArg(a))
	}
	*out = append(*out, "git "+strings.Join(quoted, " "))
}

// quoteArg quotes one argument for display, so a copied command runs as
// it did here.
func quoteArg(a string) string {
	if a == "" {
		return "''"
	}
	if !strings.ContainsAny(a, " \t\n'\"\\$`*?[]{}()<>|&;#!~") {
		return a
	}
	return "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
}
