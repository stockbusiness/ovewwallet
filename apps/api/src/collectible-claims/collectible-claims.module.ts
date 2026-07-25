import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { ClaimSessionRepository } from "./claim-session.repository";
import { ClaimSessionResolver } from "./claim-session-resolver.service";
import { CollectibleClaimsController } from "./collectible-claims.controller";
import { ConfirmClaimUseCase } from "./confirm-claim.use-case";
import { GetClaimOverviewUseCase } from "./get-claim-overview.use-case";
import { OptionalSessionLookupService } from "./optional-session-lookup.service";

/** NFTカードClaim導線実装指示書。/claim/{token}のClaim概要・確定APIをまとめる。 */
@Module({
  imports: [IntegrationsModule],
  controllers: [CollectibleClaimsController],
  providers: [
    ClaimSessionRepository,
    ClaimSessionResolver,
    GetClaimOverviewUseCase,
    ConfirmClaimUseCase,
    OptionalSessionLookupService,
  ],
})
export class CollectibleClaimsModule {}
