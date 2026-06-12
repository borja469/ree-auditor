import { Module } from "@nestjs/common";
import { OmieSiom2ClientService } from "./omie-siom2-client.service";
import { OmieSiom2Controller } from "./omie-siom2.controller";
import { OmieXmlSigner } from "./signature/omie-xml-signer";
import { OmieSoapBuilder } from "./soap/omie-soap-builder";

@Module({
  controllers: [OmieSiom2Controller],
  providers: [OmieSiom2ClientService, OmieSoapBuilder, OmieXmlSigner],
  exports: [OmieSiom2ClientService, OmieSoapBuilder]
})
export class OmieSiom2Module {}
