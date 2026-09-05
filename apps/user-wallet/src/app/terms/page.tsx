import { LegalDocumentView } from "@/components/LegalDocumentView";

/**
 * 利用規約。以前はこのファイルに文言を直接書いていたが、修正のたびにコード変更と
 * デプロイが必要だったため、管理画面から編集できるようにした
 * (docs/legal-documents.md)。
 */
export default function TermsPage() {
  return <LegalDocumentView slug="terms" backHref="/login" />;
}
