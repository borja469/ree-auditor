export class ReeEsiosPrivateMessagesQueryDto {
  date?: string;
  startTime?: string;
  endTime?: string;
  intervalType?: "Application" | "Server";
  messageType?: string;
  messageIdentification?: string;
  owner?: string;
  code?: string;
}
