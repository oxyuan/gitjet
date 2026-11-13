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
