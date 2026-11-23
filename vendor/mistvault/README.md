# Mistvault runtime reference

This directory contains an unmodified copy of the runtime source provided in
the tik-choco `mistvault` repository's `src/` and its MPL-2.0 license. Tests, test
fixtures and build output are omitted.

The GitHub dependency remains declared and locked in the app. The pinned
published revision, `4c2e31ad73e03fc9d302fe4a8a5008e7dc451707`, lacks the scope
vault API supplied in the local reference. Vite and TypeScript resolve the app's
mistvault imports to this source until that API is released.
