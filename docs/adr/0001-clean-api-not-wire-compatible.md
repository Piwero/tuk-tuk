# Clean, conventional HTTP API; no wire compatibility with the reference product

tuk-tuk's product behavior and data semantics are informed by the competitive research in `docs/research/`, but its HTTP API is designed clean rather than reproducing the researched product's public API surface. That API carries warts we deliberately do not copy: POST-for-update, misspelled parameter names, completion enums that differ between a task and its checklist items, no pagination, and no documented error bodies. tuk-tuk uses conventional REST: PUT/PATCH for updates, one consistent completion representation, pagination on collection endpoints, and a defined error envelope.

Consequence: clients built against the reference product's API cannot point at tuk-tuk unchanged. A compatibility shim was considered and deferred — if ever needed, it can be layered over the clean core.

The research dossier (Part II) remains the reference for *semantics* (priority levels, RRULE recurrence, iCal-style reminder offsets, sparse sort-order scheme), which we do keep.
