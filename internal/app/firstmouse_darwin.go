//go:build darwin

package app

import (
	"log"
	"sync"

	"github.com/ebitengine/purego/objc"
)

var firstMouseOnce sync.Once

// acceptFirstMouse makes the first click in a window that is not key act at
// once, as in most macOS apps, instead of only activating GitJet: AppKit asks
// the view under the pointer, and WebKit's WKWebView answers no, so a click
// aimed at a button after switching to GitJet went nowhere and had to be
// repeated. MyGo draws page windows in its own MyGoWebView subclass but does
// not override the method; adding it to the class fixes every window. The KVO
// subclass WebKit installs on it inherits the method.
func acceptFirstMouse() {
	firstMouseOnce.Do(func() {
		cls := objc.GetClass("MyGoWebView")
		if cls == 0 {
			log.Print("gitjet: MyGoWebView is not registered; clicks in an inactive window only activate it")
			return
		}
		imp := objc.NewIMP(func(objc.ID, objc.SEL, objc.ID) bool { return true })
		// BOOL acceptsFirstMouse:(NSEvent *): BOOL self, SEL, NSEvent *.
		cls.AddMethod(objc.RegisterName("acceptsFirstMouse:"), imp, "B@:@")
	})
}
