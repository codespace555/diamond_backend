import { SocketService } from "@/services/socket.service";

declare global {
  // eslint-disable-next-line no-var
  var socketService: SocketService;
}
