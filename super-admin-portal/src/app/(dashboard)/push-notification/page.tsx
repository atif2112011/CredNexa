import { PageHeader } from "@/components/shell/page-header";

import { PushNotificationForm } from "./push-notification-form";

export default function PushNotificationPage() {
  return (
    <>
      <PageHeader
        title="Push Notification"
        description="Send a custom push notification to borrower, tenant, or partner app users."
      />
      <PushNotificationForm />
    </>
  );
}
