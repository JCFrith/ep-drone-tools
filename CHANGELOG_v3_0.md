# EP Drone Tools: update to CoW 107W-2026-01762

Governing source: Certificate of Waiver and Authorization 107W-2026-01762, signed, effective 13 AUG 2026 to 31 JAN 2030, supersedes 107W-2025-04534 (uploaded 21 SEP 2026). Baseline compared: 107W-2025-04534 as issued (project file) and rule matrix v2.4 (ep-drone-tools repo, commit 8163fb3, 27 JUL 2026).

Files changed: site-assessment.html (tool v7.0), coa-waiver-rules.json (v3.0), ep-rules-loader.js (v3.0), ep-site-classification-wizard.html, index.html. drone-pricing-calculator.html untouched.

## Certificate changes implemented

| Area | 107W-2025-04534 (v2.4 rule) | 107W-2026-01762 (v3.0 rule) |
|---|---|---|
| Airspace profile | SP 13 standard, SP 14 CI, SP 15 linear shielding, each with own geometry | Single SP 11 shielded profile. Site character is descriptive only. CI basis field and transition-corridor check removed. |
| Shielded altitude | 100 ft AGL or obstruction + 100 (200 with DAA), no lateral radius on face | 200 ft AGL, or obstruction + 100 within a 100 ft radius, max 400 ft. DAA has no effect. UASFM grid height takes precedence (SP 11(c)). SP 13(b) lateral interpretation deleted. |
| Shielded range | 1 SM from takeoff unless VOs observe 2 SM (SP 13(d)) | No range limit. CLS-006 and the range condition deleted. Operational area confinement remains (SP 11(d), SP 32). |
| Non-shielded | SP 12, DAA or VO | Unchanged text, renumbered subclauses to roman. Neither DAA nor VO still means not a waiver operation (CLS-003). DAA observation check added (C2-010). VO training check added (VO-003, SP 12(f)). |
| MTOW | Blanket 3.5 lb cap (SP 20) | No blanket cap. Caps apply only to overflight: 8.8 lb non-PRS (SP 13(f)), 10 lb PRS (SP 14(d)), 0.88 lb (SP 15(c)). |
| PRS | Required for all aircraft over 0.88 lb (SP 23); EP interpretation scoped it to overflight | PRS is a pathway (SP 14). New rules: 7-day defect verification (14(f)), no modification and repack after deployment (SP 24), planned altitude at or above minimum deployment height (14(g)). |
| VO for overflight | At least one VO for every OOP/OOMV operation (SP 33); EP closed-site interpretation | Deleted. No VO requirement attaches to overflight. VO or DAA is driven only by non-shielded classification. VO-001, COND-VO-CONTROLLED and the SP 33 interpretation removed. |
| Restricted access | Sustained OOMV allowed inside closed site (SP 28) | Restricted access is now the condition for the non-PRS pathway (SP 13(a)), with site-related persons in PPE and notified (13(a)(b)). New fields ppeConfirmed and PPE check. |
| Sustained overflight | Permitted inside closed site | Prohibited on every pathway (13(d), 14(b), 15(b)). CLS-007 blocks it. |
| Open-air assemblies | Coordination pathway (SP 29) | Prohibited on every pathway, no coordination alternative. New field openAirAssembly; CLS-005/006 and PROP-005 block it. |
| Prop guards | All aircraft (SP 25) | Only the SP 15 pathway (15(d)). AC-005 scoped accordingly. |
| OOMV floor | 50 ft AGL for 0.88 lb or less (SP 26(c)) | Deleted. Only the PRS minimum deployment height floor survives (SP 14(g)). |
| §107.41 | Not an airspace authorization | SP 16 authorizes operations at or below UASFM grid with NOTAM 24 to 72 hours prior, verified issued. New field uasfmOps; AIR-002 to AIR-005 and COND-UASFM. LAANC may not be used for waivered operations. |
| Multi-UAS | Aggregated solution, redundant flight control (SP 17) | Specified Flight Management System, up to 6 (SP 17(a)). AC-018 and AC-019 added. 400 ft multi-UAS ceiling clause dropped (107.51 still applies). |
| RPIC location | RPIC and EO co-located in the same ops center in CONUS (SP 11) | RPIC within CONUS only (SP 10). Co-location check reworded. |
| Dock | Lighting requirement (SP 36(b)) | Dock evaluated under §107.15 and §107.49 for remote condition check, area clearing and weather (SP 25(b)(iv)). GRD-008 now fires for "Dock deployment" and "Both" (v2.4 only fired on "Dock deployment"). |
| sUAS modification | Not stated | Prohibited, identical replacement parts only (SP 28). AC-016 added. |
| Maintenance | Log (SP 43) | Log (SP 30(b)) plus functional test flight after maintenance (30(c)). AC-017 added. |
| Renumbering | SP 18(a)(1)-(4), 19, 22, 24, 27, 34/45, 37, 39, 40, 43, 44 | SP 18(a)(i)-(iv), 19, 21, 22, 23, 32, 26, 29, 27, 30, 31. All provision citations remapped. |

## Retained as EP practice (not in 107W-2026-01762). Program Manager decision required

Each is labelled "EP practice" in the provision column and keeps the severity it had in v2.4. Keep, downgrade, or drop:

- AIR-008 low-level operations within 1 SM (old SP 31(a)), NOT APPROVED
- GRD-005 pedestrian and vehicle traffic documented (old SP 31(b)), NOT APPROVED
- OBS-002 highest obstacle recorded (old SP 31(c)), NOT APPROVED
- DOC-002 pre-flight hazard checklist (old SP 31), NOT APPROVED
- GEO-003 RTH altitude programmed (old SP 32, 107.51(b)), NOT APPROVED
- GEO-004 RTH trigger configured (old SP 32 5-second rule), NEEDS PROGRAM REVIEW
- GRD-007 illumination or daytime assessment (old SP 38), NEEDS PROGRAM REVIEW
- PATH-006 simulation testing (old SP 41), NEEDS PROGRAM REVIEW
- PROP-003 non-participant notification (old SP 18(f)), NEEDS PROGRAM REVIEW outside the SP 13 pathway; mandatory under SP 13(b) on that pathway (OONP-003)
- PROP-004 direct participants identifiable (old SP 18(g)), NEEDS PROGRAM REVIEW

If the Operations Manual v3.0 retains these procedures, they are binding through SP 19(c) regardless of this decision.

## EP operating interpretations recorded in the matrix

1. SP 12 with neither DAA nor VO is outside the waiver (certificate structure, (b) or (c)).
2. Exactly 0.88 lb falls under both "=> 0.88" (SP 13/14) and "<= 0.88" (SP 15). EP applies SP 15 at that weight. Written FAA clarification recommended.
3. "Open air assemblies of persons" is undefined. EP applies plain meaning; overflight prohibited on every pathway. Written FAA clarification recommended.
4. Retained EP-practice items listed above.

## Data compatibility

Assessments saved under 107W-2025-04534 open with a banner and are re-evaluated against v3.0. Check slots whose meaning changed (property-8, shield-4, shield-10, ground-3, ground-13, rf-9, risk-5, airspace-1) are cleared on first open; everything else is kept for re-verification. New checks were appended to the end of each section so existing positional check IDs are unchanged.

## Engine

Two test types added to the rule engine (site-assessment.html and ep-rules-loader.js): fieldAtMostField and fieldAtLeastField, used for planned altitude vs computed ceiling, planned altitude vs UASFM grid, shielded altitude vs UASFM grid, and planned altitude vs PRS minimum deployment height.

## Browser test (headless Chromium, 21 SEP 2026)

128 rules, 24 conditions, 0 unmapped keys in every scenario. Verified: shielded altitude math (60 ft obstruction gives 200, 250 gives 350, 350 caps at 400, grid 200 caps at 200); non-shielded with neither DAA nor VO blocks; DAA compromised gives 200; SP 13 blocks on open site and on missing PPE, passes on restricted site with PPE, blocks above 8.8 lb; SP 14 blocks above 10 lb, on missing minimum deployment height, and on planned altitude below it; SP 15 blocks without prop guards; sustained and open-air assembly block on every pathway; SP 16 requires grid height and NOTAM assignment and blocks planned altitude above grid; 7 aircraft blocks; planned altitude above computed ceiling or above 400 ft blocks; "Both" launch method triggers dock evaluation; full pass reaches APPROVED WITH CONDITIONS with 0 blocking and 0 review; legacy assessment migration shows the banner and clears the changed slots. Wizard logic and click-through verified for shielded, non-shielded (neither, DAA, VO), and all three overflight pathways. Index renders the new certificate strip. Only console errors are cross-origin font loads from localhost, which do not occur on the GitHub Pages domain.

## Deploy

Upload the five changed files to the ep-drone-tools repo root. The live page picks up coa-waiver-rules.json at load and reports "loaded from server" if it differs from the embedded copy; upload site-assessment.html and coa-waiver-rules.json together so they do not disagree.

# Pricing calculator v3.0: editable catalog and markups (21 SEP 2026)

Every price now comes from Supabase, edited in the tool by admin accounts. Nothing is hardcoded.

- Tables: pricing_catalog (30 items: docks, aircraft, kit components, software, services), pricing_kits (5 templates), pricing_settings (one row: hardware markup, labor markup, markup definition, financing uplift, hours per year, default billing rates). pricing_authorized_users gained is_admin; both of Chase's accounts are flagged. Read for any authorized user; write for admins only, enforced by RLS.
- Item fields: cost, pricing (cost plus markup, or fixed price), optional per-item markup override, basis (one-time, per dock one-time, per program per year, per dock per year, per aircraft per year, per tactical kit per year), trigger (fleet = chosen in the dock builder, kit = used inside kits, auto = applies whenever its quantity is above zero, toggle = checkbox in the quote), default on, applies-to tag (a service that only applies to aircraft carrying that tag, e.g. cellular), capacity and bundled aircraft for docks, active flag.
- Markup definition is a setting: markup on cost (cost x (1 + pct)) or margin on price (cost / (1 - pct)). Labor internal rate follows the same setting. Each quote can override hardware and labor markup percentages.
- Quotes snapshot the full catalog and settings at save. A reopened quote is priced with its snapshot and shows what changed in the live catalog since, with a Reprice button. Nothing reprices silently. Quotes saved before this version are flagged legacy and priced at the current catalog until re-saved.
- Legacy dock, aircraft, kit and option keys are mapped to catalog slugs on load, so the existing saved quotes open.
- Seed costs were derived from the prior hardcoded prices at 35 percent markup and verified to reproduce them exactly. Software and services are fixed price with no markup, matching prior behavior.
- If the live catalog cannot load, the tool falls back to an embedded copy of the seed and says so in a banner; do not send quotes in that state.
- Client PDF fleet list and the fleet summary are now generated from the catalog names.

Adding a new item (for example a Vantage beeper): Catalog & Pricing Settings, Add catalog item, set cost and category. For a kit part, trigger kit and add it to the kit template. For an optional line on quotes, trigger toggle and choose the basis. For a new dock or aircraft, category dock or aircraft with trigger fleet; docks need capacity, and a bundled aircraft if it ships with one.
