# Site assessment tool v8.0 / rule matrix v4.0

## Every SP citation spelled out
No provision appears anywhere in the app, the rule matrix, the classification wizard, or the
hub as a bare "SP ##". Every citation is now "Plain-language name (SP ##)", e.g. "Non-Shielded
Operations (SP 12)", "PRS-Equipped Overflight, Minimum Deployment Height (SP 14(g))". Same name
reused everywhere that provision is cited. Checked programmatically: zero bare citations remain
in any of the four files.

## Section 2, Aircraft & Equipment Verification: trimmed to 4 items
Removed: Remote ID, ADS-B In/Out, independent FTS and FTS/geofence verification (multi-aircraft),
eligible-UAS list entry, maintenance log, FCC compliance, PRS 7-day defect check, PRS
unmodified/repacked, sUAS unmodified, post-maintenance test flight, multi-UAS FMS match.
These are aircraft-state facts that don't vary by site; they belong on a per-flight aircraft
readiness checklist, not a per-site record. That checklist does not yet exist in this tool suite;
these 12 certificate provisions are not tracked anywhere until one is built.
Kept and consolidated: rotating component shielding, anti-collision lighting, PRS operational
status, and the four GCS sub-items (SP 27(a) to (d)) merged into one combined check.

## Section 5, Shielding Geometry: 4 removed, 2 kept as hard constraints
Removed (duplicates of Section 9/10 items covering the same requirement): RTH inside shielding
geometry, aircraft within the defined operational area, emergency descent paths within
containment, seasonal variation in natural obstructions.
Kept at your instruction, both flagged "Hard constraint, always flown under" in the UI: the 100 ft
lateral radius confirmation and the UASFM grid precedence confirmation. These are the manual checks
behind the altitude ceiling the determination card computes.

## Section 4, Property & Access: 2 removed (duplicates of Section 1)
Open-air assembly and PPE/restricted-access were being asked twice: once as structured fields in
Section 1 that drive the determination card and blocking rules, and again as plain checkboxes in
Section 4. Section 4's copies are gone; Section 1 is now the only place these are recorded.

## Section 6: duplicate PRS-floor field removed
Section 2 already collects the PRS minimum deployment height (prsMinAlt) and the rule engine
already checks planned altitude against it. Section 6 asked for the same number a second time
under a different field name (oomvFloor) with no rule ever reading it. Removed.

## Section 7: removed "Urban canyon and multipath conditions assessed"
Only instance of this exact item; removed as requested.

## N/A added
"Site restricted from the general public" and the PPE field now accept N/A, for sites where the
Non-PRS Overflight pathway doesn't apply (PRS-equipped or 0.88 lb or under aircraft). No rule
impact: both fields already only gate approval when that pathway is in use.

## Ground crew / RPIC split
Sections 3, 4, 9, 10, 11 and 12 now group their items under two headings: items a ground crew
member can complete from direct observation at the site, and items requiring RPIC judgment or a
certificate-interpretation call. The split is per item, not per section; Section 12 (Risk
Determination) turned out to be entirely RPIC once sorted this way, which tracks, since risk
determination is squarely the RPIC's call.
Before the approval decision can be reached in Section 13, a single RPIC attestation gate requires
checking "I am the RPIC and have reviewed this assessment in its entirety" with a name and
timestamp. This is one attestation covering the whole assessment, not per-section sign-off.

## Two assessment types
New Assessment now opens a type choice instead of creating a blank record immediately:
- **Fixed Site Assessment**: today's full 13-section workflow, unchanged.
- **Hasty Assessment**: a condensed ground-crew form (site name, date, assessed by, launch
  method, coordinates, obstruction continuity, planned altitude, open-air assembly, overhead
  wires, one hazard photo). Built for search-and-rescue or crash-documentation missions where the
  ground crew needs to be flying in under 5 minutes. "Submit to RPIC" locks that portion and opens
  the full assessment for the RPIC to complete the remaining sections at their own pace, ending at
  the same RPIC attestation and approval decision as a fixed assessment. A banner marks the record
  as hasty throughout.
The type-choice and hasty-submit flow uses an in-page form, not window.prompt() or confirm(),
since those silently no-op in some embedded browsers (the same class of bug found and fixed in
the pricing calculator).

## Rule matrix v4.0
128 rules -> 111. 17 rules deleted (tied to removed checklist items): AC-007, AC-008, AC-009,
AC-010, AC-012 through AC-018, AC-020, SHLD-007, SHLD-008, PROP-005, PROP-007, OONP-007. AC-011
(GCS) retargeted to cover the consolidated check. No other rule logic changed; the two Section 5
hard-constraint rules (SHLD-005, SHLD-009) are untouched and still gate approval exactly as
before.

## Data compatibility
Tool version bumped 7.0 -> 8.0. Two independent legacy migrations now run on every load, either or
both firing as needed: the existing certificate migration (107W-2025-04534 records), and a new
v8.0 migration that clears check-state at every position whose meaning changed in this rebuild
(all of Section 2's positions, plus the handful of shifted positions in Sections 5, 6 and 7).
Everything else is preserved for re-verification, not deleted. A banner names which migrations
applied and when. Assessments made between the July certificate rebuild and this one are exactly
the case the v8.0 migration exists for: already on the current certificate, still needed their
Section 2 through 7 check-state cleared, and are handled correctly by triggering the tool-version
migration independently of the certificate one.

## Testing
Headless Chromium: rules mapping (0 unmapped keys, 0 unmapped rules), confirmed all 17 dead rule
IDs actually gone, Section 2 renders exactly 4 items, Section 5 renders exactly 8 with the two
hard constraints still blocking until checked, N/A accepted on both fields, role grouping present
on split sections and absent on non-split sections, spelled-out citations confirmed in rendered
DOM text, full hasty-assessment flow end to end (type modal, empty-submit blocked, valid submit
transitions to RPIC phase with banner, 14 sections render), RPIC attestation gate blocks and then
reveals the approval decision, legacy migration clears the correct keys on a simulated v7.0 record
while leaving unaffected keys untouched. Zero console errors outside unrelated font CORS noise.
