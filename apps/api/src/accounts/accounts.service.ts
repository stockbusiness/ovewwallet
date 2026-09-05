import { Injectable } from "@nestjs/common";
import { type OveAccount } from "@ove/database";
import { AccountClosureService } from "./account-closure.service";
import {
  AccountRegistrationService,
  CURRENT_TERMS_VERSION,
  type FindOrCreateIdentityParams,
} from "./account-registration.service";
import { AccountRepository } from "./account.repository";
import { SessionManagementService } from "./session-management.service";

export { CURRENT_TERMS_VERSION, type FindOrCreateIdentityParams };

/**
 * リファクタリング指示書 Phase 2: 旧`AccountsService`はここまで縮小した
 * Facade。実装は`AccountRegistrationService`・`CommonUserLinkingService`・
 * `SessionManagementService`・`AccountClosureService`へ分割済みで、このクラスは
 * 既存の呼び出し元 (auth.service.ts, admin-migration.service.ts,
 * accounts.controller.ts) との互換性を保つためだけに同じpublicメソッドシグネチャで
 * 委譲する (外部サービスAPI経由のアカウント自動作成は`GrantExternalServiceRewardUseCase`
 * がServiceIntegration行ロック配下で直接行うため、ここには存在しない。PR #1最終修正)。
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly registration: AccountRegistrationService,
    private readonly sessions: SessionManagementService,
    private readonly closure: AccountClosureService,
  ) {}

  async getById(oveAccountId: string): Promise<OveAccount | null> {
    return this.accountRepository.findById(oveAccountId);
  }

  async hasIdentity(provider: string, providerSubject: string): Promise<boolean> {
    return this.registration.hasIdentity(provider, providerSubject);
  }

  async findOrCreateByIdentity(params: FindOrCreateIdentityParams): Promise<OveAccount> {
    return this.registration.findOrCreateByIdentity(params);
  }

  async listSessions(oveAccountId: string, currentSessionId: string) {
    return this.sessions.listSessions(oveAccountId, currentSessionId);
  }

  async revokeSession(oveAccountId: string, sessionId: string): Promise<void> {
    return this.sessions.revokeSession(oveAccountId, sessionId);
  }

  async revokeOtherSessions(oveAccountId: string, currentSessionId: string): Promise<{ revoked_count: number }> {
    return this.sessions.revokeOtherSessions(oveAccountId, currentSessionId);
  }

  async requestClosure(oveAccountId: string): Promise<{ closed: true }> {
    return this.closure.requestClosure(oveAccountId);
  }
}
