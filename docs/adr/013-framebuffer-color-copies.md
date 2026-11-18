# ADR 013 — Color renderbuffer storage and framebuffer copies

Status is accepted for task 046.

A color renderbuffer has a distinct logical object and storage generation. The bridge resolves that generation to one canonical color image, shared by every framebuffer that attaches it. The host uses RGBA8 for RGBA4 and RGB5_A1 and opaque RGBA8 for RGB565. GLES allows implementation-selected component resolution. Queries report the allocated sizes, with no logical alpha channel for RGB565. Reallocation and final detachment retire the previous generation after its queued GPU uses.

The cores validate copyTexImage2D and copyTexSubImage2D against the currently bound source and the exact destination image. Each successful copy carries a resolved source target and a new destination texture version. BrowserHost encodes the clipped region while the source is current. An image definition initializes uncovered texels and a subimage copy inherits the old destination allocation's pixels outside the written region. The GPU pass performs channel conversion, preserving GL coordinates and ignoring upload pixel-store state.

Resource capability 6 adds the color renderbuffer target variant and the ordered copy operation. Retiring a renderbuffer generation now covers either color or depth storage. Draw, readback and DOM entry points keep ABI4, readback1 and DOM upload2, with initialization rejecting stale resource capabilities.
