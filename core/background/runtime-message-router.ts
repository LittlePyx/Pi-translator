import type { RuntimeMessage } from '../messaging/messages';

export type RuntimeMessageSender = Browser.runtime.MessageSender;
export type RuntimeMessageType = RuntimeMessage['type'];
export type RuntimeMessageOfType<Type extends RuntimeMessageType> = Extract<
  RuntimeMessage,
  { type: Type }
>;

export type RuntimeMessageHandler<
  Type extends RuntimeMessageType,
  Sender = RuntimeMessageSender,
> = (
  message: RuntimeMessageOfType<Type>,
  sender: Sender,
) => Promise<unknown> | undefined;

export type RuntimeMessageHandlers<Sender = RuntimeMessageSender> = {
  [Type in RuntimeMessageType]?: RuntimeMessageHandler<Type, Sender>;
};

export function routeRuntimeMessage<Sender>(
  handlers: RuntimeMessageHandlers<Sender>,
  message: RuntimeMessage,
  sender: Sender,
): Promise<unknown> | undefined {
  const handler = handlers[message.type] as
    | ((candidate: RuntimeMessage, source: Sender) => Promise<unknown> | undefined)
    | undefined;
  return handler?.(message, sender);
}
