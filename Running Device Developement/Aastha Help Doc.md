# Aastha Help Doc

This guide explains how to use the super-admin portal for borrower onboarding and device testing, and which permission document to follow for the running APK.

## 1. Device Details Page

The **Device Details** page now includes a **Testing Panel** for both **Running Provisioned** and **QR Provisioned** devices. Aastha can use these buttons instead of manually calling the corresponding testing APIs.

### How to use it

1. Sign in to the super-admin portal.
2. Open **Devices** and select the device to open its details. Alternatively, click **View Device** against an enrolled test borrower in **Dev Tools**.
3. Check the device's provisioning type and dealer mode, then open its **Testing Panel**.
4. Choose the test, read its description, and confirm the action.
5. Check the borrower phone, updated EMI schedule, and command history to verify the outcome. A queued command is not confirmation that the phone has applied it; check the device acknowledgement.

Available tests depend on the device type, Automatic/Manual dealer mode, current state, schedule, and supported controls. Disabled options display the reason.

| Test group | Examples |
| --- | --- |
| Reminders | Send Upcoming Reminder; Send Overdue Reminder |
| EMI simulations | Simulate Upcoming EMI Cron; for Automatic dealers, Simulate EMI Grace and Simulate EMI Auto-lock |
| Manual schedule simulations | Set the installment due in six days, overdue, in grace, or paid. These actions change the schedule without queuing a device command. |
| Device controls | Test Lock, Full Unlock, Temporary Unlock, Temporary Unlock Expiry, and Location Request, where enabled |
| Payment and release | Record Payment & Test Outcome; Settle & Release Device |

For running devices, lock tests operate the app overlay. QR provisioned devices use their managed-device controls. Testing actions can change live EMI/device records and send commands, so select the intended test borrower/device before confirming. **Settle & Release Device** pays all remaining installments and queues permanent release.

## 2. Dev Tools Page

Use **Dev Tools** to create test borrowers and display their enrollment QR codes directly in the portal. Aastha no longer needs to call APIs manually for these steps.

### Create and onboard a test borrower

1. Open **Dev Tools** from the navigation menu.
2. In **Create Test Borrower**, select **QR Provisioned** or **Running Provisioned**. QR Provisioned is selected by default.
3. Search for and select a dealer. The dropdown shows eligible Automatic and Manual dealers, including dealers with zero keys. Changing the provisioning type clears the selected dealer.
4. Click **Create Test Borrower**. Borrower details are generated automatically, with a ₹12,000 loan and six ₹2,000 EMIs. **No dealer key is charged.**
5. Note the displayed borrower mobile and test OTP, **123456**.
6. Find the new borrower in the **Test borrowers** table and click **Show QR**. The modal shows the QR, borrower identity, provisioning type, expiry, and test OTP.
7. For **Running Provisioned**, scan the QR inside the running borrower APK. For **QR Provisioned**, scan it during Android device setup. Complete the relevant onboarding flow.
8. Close the QR modal or click **Refresh**. After enrollment, **View Device** replaces **Show QR** and opens the linked device's details for testing.

The table supports search by borrower name, mobile, loan ID, or dealer name, plus pagination with **20, 50, or 100 rows** per page. Generated borrowers use the names `TESTBORROWER-QR-…` or `TESTBORROWER-RUNNING-…`; older test borrowers with other naming conventions are not automatically listed here.

**Show QR** is available for active, unlinked borrowers. If a linked device cannot be resolved, the table shows an unavailable-device status rather than offering another enrollment QR.

## 3. Updated Running APK Permission Assessment

Read the updated [Running APK permission assessment](<D:/Practise Projects/EMI Shield/Running Device Developement/Running APK permission assessment.md>) when implementing the running APK's permission checklist.

The document has been corrected and simplified to implementation context and a single permission table. It identifies the permissions/settings to implement, explains their use and Android limitations, and explicitly marks permissions to skip.

- **Implement every item marked required, reliability feature/option, or future use in the current permission checklist.** Future use means implement the permission flow now; agree on the associated future feature before enabling its behavior.
- Follow the table's displayed order: **Location → Auto Start → Accessibility / Allow restricted settings → Write Setting → Battery Power Usage → Device Admin → Overlay → Runtime permissions → Battery Optimization**. Usage Access appears in the reference table but is explicitly skipped; phone permissions are also skipped.
- The order describes the checklist sequence; it does not automatically grant access or bypass Android restrictions. For location, request foreground access before background access. Request camera access when opening the QR scanner.
- Implement the manual **Allow restricted settings** guidance where Android blocks supported access. This action is separate from granting overlay access or enabling an Accessibility service.
- Inclusion in the checklist does not automatically make a permission an enrollment blocker. The current backend requires fresh notification and overlay reports; Device Admin remains optional.
- If a purpose, Android/OEM behavior, or requirement is unclear, **ask the senior developer**. Do not invent behavior or silently omit an item.

Older development documents remain useful for the existing app and enrollment flows. For permission ordering and implementation decisions, use this updated assessment; where an older permission instruction conflicts with it, follow the updated assessment and raise unresolved conflicts with the senior developer.
