# Project status and roadmap

MLCC Alternate Finder is a portfolio prototype for screening ceramic-capacitor alternatives when a component is constrained. It demonstrates a rules-based comparison, supply-planning estimates, a small simulated catalog, and a live distributor-data integration.

## What works

- Search by manufacturer part number or a supported BOM description.
- Compare candidates against capacitance, package, height, voltage, dielectric, temperature, tolerance, grade, termination, lifecycle, and manufacturer checks.
- Flag what engineering must review: DC bias, height and termination.
- Estimate supply and approval timing when inputs are available.
- Query Nexar first and use Mouser as a fallback; keep provider credentials in Worker secrets.
- Fall back to a clearly identified demo catalog when a description is entered or live data doesn't answer within 5 seconds, using specs read from the part number when it isn't in the catalog.

## Known limitations

- Distributor listings can omit or localize specifications; incomplete parts are not reliably comparable and should not be treated as approved substitutes.
- Provider access depends on account plans and quotas. The fallback may also lack the fields needed to find or validate an alternate.
- The demo catalog includes simulated stock, lead times, and prices; its specifications still require systematic datasheet verification.
- Approval durations are illustrative assumptions, not company-specific commitments.
- This is a screening aid, not an engineering approval or procurement commitment.

## Next improvements

1. Verify provider field mappings and lifecycle/specification data against current manufacturer datasheets.
2. Improve handling of supplier-recommended replacements and localized listing descriptions while keeping recommendations explicitly unverified until checked.
3. Add browser-level tests for provider failures, incomplete data, keyboard use, and mobile layouts.
4. Read DC-bias curves from manufacturer tools (Murata SimSurfing, KEMET K-SIM, TDK SEAT) to replace the DC-bias flag with an effective-capacitance estimate.
5. Consider multi-line BOM screening after the single-part workflow and data quality are dependable.
