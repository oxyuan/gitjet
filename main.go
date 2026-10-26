// GitJet is a desktop Git client for reviewing changes, reading source and
// resolving merge conflicts line by line.
package main

import (
	"log"

	"gitjet/internal/app"
)

func main() {
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
