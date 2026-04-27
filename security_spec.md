# Security Specification - FotoFarma

## 1. Data Invariants
- A **User Profile** must only be accessible and modifiable by the owner (UID match).
- A **Prescription** must belong to a user and only be accessible by them.
- A **Reminder** must be linked to a user via `uid`. Users can only see/edit their own reminders.
- **Push Subscriptions** are managed by the server but linked to a `uid`.

## 2. The "Dirty Dozen" Payloads (Denial Tests)

### reminders
1. **Unauthorized Create**: Create reminder for another user (`uid` mismatch).
2. **Unauthorized Read**: Read reminder belonging to another user.
3. **Unauthorized Update**: Update `completed` status of another user's reminder.
4. **Malicious ID**: Create document with 2KB string as ID.
5. **Schema Poisoning**: Add `isAdmin: true` to a reminder document.
6. **Type Mismatch**: Send `time: 123` (number instead of string).
7. **Size Attack**: Send `name` with 1MB of text.
8. **Relational Break**: Update a reminder to change its `uid` to someone else.
9. **State Shortcut**: (Not applicable here as states are simple).
10. **Timestamp Spoofing**: (If we used server timestamps).
11. **PII Leak**: Querying `/users` without UID filter (blanket read).
12. **Shadow Field**: Adding `verified: true` to user profile.

## 3. Test Runner (Draft)
(Tests would verify that all above payloads return PERMISSION_DENIED)
