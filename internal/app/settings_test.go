package app

import "testing"

func TestClampAutoSaveIdleSeconds(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, 15},
		{1, 1},
		{15, 15},
		{300, 300},
		{301, 15},
		{-5, 15},
	}
	for _, c := range cases {
		s := Settings{AutoSaveIdleSeconds: c.in}
		s.clamp()
		if s.AutoSaveIdleSeconds != c.want {
			t.Errorf("clamp(%d) = %d, want %d", c.in, s.AutoSaveIdleSeconds, c.want)
		}
	}
}

func TestClampLanguagePacks(t *testing.T) {
	s := Settings{}
	s.clamp()
	if len(s.LanguagePacks) == 0 {
		t.Fatal("a missing pack list must mean the built-in defaults")
	}
	s = Settings{LanguagePacks: []string{}}
	s.clamp()
	if s.LanguagePacks == nil || len(s.LanguagePacks) != 0 {
		t.Fatalf("an explicit empty list = %v, want empty", s.LanguagePacks)
	}
	s = Settings{LanguagePacks: []string{"python", "go", "removed", "go"}}
	s.clamp()
	if len(s.LanguagePacks) != 2 || s.LanguagePacks[0] != "go" || s.LanguagePacks[1] != "python" {
		t.Fatalf("clamped packs = %v", s.LanguagePacks)
	}
	s = Settings{LanguageServers: []LanguageServerPath{
		{PackID: " java ", Path: " /opt/jdtls "},
		{PackID: "java", Path: "/other"},
		{PackID: "removed", Path: "/x"},
		{PackID: "go", Path: "  "},
	}}
	s.clamp()
	if len(s.LanguageServers) != 1 || s.LanguageServers[0].PackID != "java" || s.LanguageServers[0].Path != "/opt/jdtls" {
		t.Fatalf("clamped servers = %+v", s.LanguageServers)
	}
}
