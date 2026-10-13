# Admin device testing report

Date: 13 October 2026

87 connected-database scenarios and 45 backend regression tests passed.

| Provisioning | Dealer mode | Scenarios | Result |
|---|---|---:|---|
| Running | Automatic | 20 | Passed |
| QR | Automatic | 19 | Passed |
| Running | Manual | 23 | Passed |
| QR | Manual | 22 | Passed |

The remaining scenarios cover authentication, disabled settings, missing policies, and the rendered device table.

## Verified behavior

- Provisioning and dealer mode appear in the list and detail page.
- Running devices show overlay testing and permission health; managed-only controls are hidden.
- Manual dealers have schedule-only simulations and operator controls; automatic dealers have EMI grace and auto-lock simulations.
- Reminders, lock/unlock, all seven temporary-unlock durations, expiry, payment outcomes, settlement/release, and eligible location were exercised through authenticated APIs.
- Borrower sync and simulated acknowledgements were checked, including final-payment release, expiry deduplication, and payment/full unlock superseding temporary access.
- Rejected options left device, schedule, and command data unchanged.
- Audit entries were checked for every testing action.

## Cleanup

660 records created by the final run were removed, including 93 dummy devices, 93 dummy borrowers, 106 commands, and related schedules, events, audit and delivery logs. Zero residual records were verified across database collections. Temporary test servers were stopped and the recovery manifest was removed.

## Limits

Device acknowledgements were simulated. Actual overlay display and Android permissions were not verified on a physical phone. The changes are local; deployment is separate.

## Repeat the tests

From the backend directory, run `npm run test:admin-devices:connected`. This explicitly tests disposable fixtures against the configured database and cleans up afterward. If a run is interrupted, use `npm run test:admin-devices:cleanup` with the retained manifest.
