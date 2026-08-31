import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CURRENT_TERMS_VERSION } from "./account-registration.service";
import { isTermsConsentRequired } from "./terms-consent";

export interface TermsConsentStatus {
  /** 現在有効な規約のバージョン。 */
  current_version: string;
  /** この利用者が同意済みのバージョン。一度も記録が無ければ null。 */
  agreed_version: string | null;
  agreed_at: string | null;
  /** true なら再同意するまで更新系の操作ができない。 */
  consent_required: boolean;
}

/** 利用規約の同意状態の参照と、再同意の記録 (docs/terms-consent.md)。 */
@Injectable()
export class TermsConsentService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async getStatus(oveAccountId: string): Promise<TermsConsentStatus> {
    const account = await this.db.oveAccount.findUniqueOrThrow({
      where: { id: oveAccountId },
      select: { termsVersion: true, termsAgreedAt: true },
    });
    return {
      current_version: CURRENT_TERMS_VERSION,
      agreed_version: account.termsVersion,
      agreed_at: account.termsAgreedAt?.toISOString() ?? null,
      consent_required: isTermsConsentRequired(account),
    };
  }

  /**
   * 現行バージョンへの同意を記録する。同じバージョンに複数回同意しても害はないが、
   * 同意日時は上書きする (最後に同意した時点を残すため)。
   */
  async accept(oveAccountId: string): Promise<TermsConsentStatus> {
    await this.db.oveAccount.update({
      where: { id: oveAccountId },
      data: { termsVersion: CURRENT_TERMS_VERSION, termsAgreedAt: new Date() },
    });
    return this.getStatus(oveAccountId);
  }
}
