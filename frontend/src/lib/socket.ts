import { io, type Socket } from "socket.io-client";

/**
 * Single shared Socket.IO connection to the backend. `io()` with no URL connects
 * to the current origin; nginx proxies `/socket.io/` through to the API. Used for
 * live dispatch-board updates so every open board reflects another user's changes
 * without a manual refresh.
 */
export const socket: Socket = io({ autoConnect: true });
