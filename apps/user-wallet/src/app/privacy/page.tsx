import { LegalDocumentView } from "@/components/LegalDocumentView";

/** プライバシーポリシー (管理画面から編集する。docs/legal-documents.md)。 */
export default function PrivacyPage() {
  return <LegalDocumentView slug="privacy" backHref="/wallet/menu" />;
}
