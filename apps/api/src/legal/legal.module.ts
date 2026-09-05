import { Global, Module } from "@nestjs/common";
import { LegalController } from "./legal.controller";
import { LegalDocumentsService } from "./legal-documents.service";

/**
 * 法的文書。規約バージョンは`SessionAuthGuard`からも参照するため、
 * どのモジュールからでも注入できるようにGlobalにしている。
 */
@Global()
@Module({
  controllers: [LegalController],
  providers: [LegalDocumentsService],
  exports: [LegalDocumentsService],
})
export class LegalModule {}
