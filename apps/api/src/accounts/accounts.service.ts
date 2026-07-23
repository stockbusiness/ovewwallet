import { Inject, Injectable } from "@nestjs/common";
import { type OveAccount, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  AccountRegistrationService,
  CURRENT_TERMS_VERSION,
  type FindOrCreateIdentityParams,
} from "./account-registration.service";
import { ExternalAccountProvisioningService } from "./external-account-provisioning.service";
import { SessionManagementService } from "./session-management.service";
import { AccountClosureService } from "./account-closure.service";

export { CURRENT_TERMS_VERSION, type FindOrCreateIdentityParams };

/**
 * リファクタリング指示書 Phase 2: 旧`AccountsService`はここまで縮小した
 * Facade。実装は`AccountRegistrationService`・`ExternalAccountProvisioningService`・
 * `CommonUserLinkingService`・`SessionManagementService`・`AccountClosureService`へ
 * 分割済みで、このクラスは既存の呼び出し元 (auth.service.ts, rewards.service.ts,
 * admin-migration.service.ts, accounts.controller.ts) との互換性を保つためだけに
 * 同じpublicメソッドシグネチャで委譲する。
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly registration: AccountRegistrationService,
    private readonly externalProvisioning: ExternalAccountProvisioningService,
    private readonly sessions: SessionManagementService,
    private readonly closure: AccountClosureService,
  ) {}

  async getById(oveAccountId: string): Promise<OveAccount | null> {
    return this.db.oveAccount.findUnique({ where: { id: oveAccountId } });
  }

  async findOrCreateByIdentity(params: FindOrCreateIdentityParams): Promise<OveAccount> {
    return this.registration.findOrCreateByIdentity(params);
  }

  async findOrCreateByServiceLink(params: {
    serviceIntegrationId: string;
    externalUserId: string;
  }): Promise<OveAccount> {
    return this.externalProvisioning.findOrCreateByServiceLink(params);
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
