# Single-user, no authentication in v1

v1 serves exactly one implicit user: no registration, no login, no per-user scoping in the API. This trades away a multi-user account model (and with it collaboration — shared lists, assignees, comments, which are explicitly out of v1 scope) for the fastest path to working task management.

Consequence: the schema should still carry an owner/user column (or be trivially migratable to one) so that adding accounts later is a data migration, not a remodel. Collaboration features that presuppose other users ("Assigned to Me" smart list, member permissions, @-mentions) must not leak into the v1 domain model.
