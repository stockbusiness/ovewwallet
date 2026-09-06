import { SUPPORT_CATEGORY_LABEL, SUPPORT_STATUS_LABEL, type SupportInquiry } from "@/lib/api";

/**
 * 自分が送った問い合わせの一覧 (docs/support-inquiries.md)。
 *
 * 送りっぱなしにしない。届いているのか、見てもらえているのかが分からないままだと、
 * 同じ内容を何度も送ることになる。
 */
export default function SupportInquiryHistory({ inquiries }: { inquiries: SupportInquiry[] }) {
  if (inquiries.length === 0) return null;

  return (
    <section className="rounded-xl border border-sengoku-border p-4">
      <h2 className="mb-3 text-sm font-bold text-sengoku-text">これまでのお問い合わせ</h2>
      <ul className="flex flex-col gap-3">
        {inquiries.map((inquiry) => (
          <li key={inquiry.inquiry_code} className="border-t border-sengoku-border pt-3 first:border-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-sengoku-muted">
                {SUPPORT_CATEGORY_LABEL[inquiry.category]}
              </span>
              <span className="rounded bg-sengoku-navy-deep px-2 py-0.5 text-[11px] text-sengoku-muted">
                {SUPPORT_STATUS_LABEL[inquiry.status]}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-sengoku-text">
              {inquiry.message}
            </p>
            <p className="mt-1 text-[11px] text-sengoku-faint">
              {inquiry.inquiry_code} ・ {new Date(inquiry.created_at).toLocaleString("ja-JP")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
