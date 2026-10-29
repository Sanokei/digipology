# Editor artwork handoff acceptance

Base: e607e2f4c5286a0635552bf4463c1075535dec24.

The existing desktop File→Publish handoff includes only bundle/form fields, so
artwork and review metadata disappear. File export is also bundle-only, with no
explicit editable backup choice. The publication retry label describes opening a
table even when artwork saving failed. Narrow artwork forms can leave the final
source input partly clipped above their footer.

This increment reuses the existing saved-private-play publication path. Desktop
Publish must synchronously save the latest editor snapshot before navigation and
preserve all editor metadata. An explicit editable backup includes artwork/review;
release-bundle export continues to contain only gameplay. A changed manifest leaves
the original automated review hash intact so the review is visibly stale.

Acceptance uses the real, source-pinned saved raster draft in e2e/fixtures. Import it
through desktop UI, make a real rule edit, retain authored details/image/credits,
exercise forced storage failure and keyboard-reachable backup/retry, then enter
private play and publish through the ordinary owned path. Verify the edited rule
actually executes, retry keeps the same game identity, reload/download preserves
bytes and credits, and old immutable cover versions remain exact. Open the editable
backup again and verify the same metadata/review state.

At desktop, 390×844 and 390×480, keyboard-focus the complete Public source page field
inside its own bounded scrolling form. The opaque footer must sit after the scroll
area; focused field bounds must stay wholly above it, with close/action controls
visible. Capture actual rendered frames and error/recovery states with exact refs.

No live-provider generation, new media type, production migration/deployment,
secret provisioning, network bypass or new scheduled job is part of this change.
Prior full-suite/source-by-frame scopes and the retained tool-exit anomaly remain
explicit. Production migration 0008, publishing the saved cloud draft, live-provider
configuration and observing scheduled execution are still prerequisites.
