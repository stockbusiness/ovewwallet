import { LegalDocumentView } from "@/components/LegalDocumentView";

/** 運営会社・会社情報 (管理画面から編集する。docs/legal-documents.md)。 */
export default function CompanyPage() {
  return <LegalDocumentView slug="company" backHref="/wallet/menu" />;
}
