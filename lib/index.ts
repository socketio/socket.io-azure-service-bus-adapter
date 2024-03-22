import { ClusterAdapterWithHeartbeat } from "socket.io-adapter";
import type {
  ClusterAdapterOptions,
  ClusterMessage,
  ClusterResponse,
  Offset,
  ServerId,
} from "socket.io-adapter";
import { encode, decode } from "@msgpack/msgpack";
import { randomBytes } from "node:crypto";
import type {
  CreateSubscriptionOptions,
  CreateTopicOptions,
  ProcessErrorArgs,
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiverOptions,
  ServiceBusSender,
} from "@azure/service-bus";

const debug = require("debug")("socket.io-azure-service-bus-adapter");

function randomId() {
  return randomBytes(8).toString("hex");
}

export interface AdapterOptions extends ClusterAdapterOptions {
  /**
   * The name of the topic.
   * @default "socket.io"
   */
  topicName?: string;
  /**
   * The options used to create the topic.
   */
  topicOptions?: CreateTopicOptions;
  /**
   * The prefix of the subscription (one subscription will be created per Socket.IO server in the cluster).
   * @default "socket.io"
   */
  subscriptionPrefix?: string;
  /**
   * The options used to create the subscription.
   */
  subscriptionOptions?: CreateSubscriptionOptions;
  /**
   * The options used to create the receiver.
   */
  receiverOptions?: ServiceBusReceiverOptions;
}

async function createSubscription(
  adminClient: ServiceBusAdministrationClient,
  topicName: string,
  subscriptionName: string,
  opts: AdapterOptions
) {
  try {
    await adminClient.getTopic(topicName);

    debug("topic [%s] already exists", topicName);
  } catch (e) {
    debug("topic [%s] does not exist", topicName);

    await adminClient.createTopic(topicName, opts.topicOptions);

    debug("topic [%s] was successfully created", topicName);
  }

  debug("creating subscription [%s]", subscriptionName);

  await adminClient.createSubscription(
    topicName,
    subscriptionName,
    opts.subscriptionOptions
  );

  debug("subscription [%s] was successfully created", subscriptionName);

  return {
    topicName,
    subscriptionName,
  };
}

/**
 * Returns a function that will create a {@link PubSubAdapter} instance.
 *
 * @param client - a ServiceBusClient instance from the `@azure/service-bus` package
 * @param adminClient - a ServiceBusAdministrationClient instance from the `@azure/service-bus` package
 * @param opts - additional options
 *
 * @see https://learn.microsoft.com/en-us/azure/service-bus-messaging
 *
 * @public
 */
export function createAdapter(
  client: ServiceBusClient,
  adminClient: ServiceBusAdministrationClient,
  opts: AdapterOptions = {}
) {
  const namespaceToAdapters = new Map<string, PubSubAdapter>();

  const topicName = opts.topicName || "socket.io";
  const subscriptionName = `${
    opts.subscriptionPrefix || "socket.io"
  }-${randomId()}`;

  const sender = client.createSender(topicName);
  const receiver = client.createReceiver(
    topicName,
    subscriptionName,
    opts.receiverOptions
  );

  const subscriptionCreation = createSubscription(
    adminClient,
    topicName,
    subscriptionName,
    opts
  )
    .then(() => {
      receiver.subscribe({
        async processMessage(
          message: ServiceBusReceivedMessage
        ): Promise<void> {
          if (
            !message.applicationProperties ||
            typeof message.applicationProperties["nsp"] !== "string"
          ) {
            debug("ignore malformed message");
            return;
          }
          const namespace = message.applicationProperties["nsp"];

          namespaceToAdapters.get(namespace)?.onRawMessage(message);

          if (receiver.receiveMode === "peekLock") {
            await receiver.completeMessage(message);
          }
        },
        async processError(args: ProcessErrorArgs): Promise<void> {
          debug("an error has occurred: %s", args.error.message);
        },
      });
    })
    .catch((err) => {
      debug(
        "an error has occurred while creating the subscription: %s",
        err.message
      );
    });

  return function (nsp: any) {
    const adapter = new PubSubAdapter(nsp, sender, opts);

    namespaceToAdapters.set(nsp.name, adapter);

    const defaultInit = adapter.init;

    adapter.init = () => {
      return subscriptionCreation.then(() => {
        defaultInit.call(adapter);
      });
    };

    const defaultClose = adapter.close;

    adapter.close = async () => {
      defaultClose.call(adapter);

      namespaceToAdapters.delete(nsp.name);

      if (namespaceToAdapters.size === 0) {
        debug("deleting subscription [%s]", subscriptionName);

        return Promise.all([
          receiver.close(),
          sender.close(),
          adminClient
            .deleteSubscription(topicName, subscriptionName)
            .then(() => {
              debug(
                "subscription [%s] was successfully deleted",
                subscriptionName
              );
            })
            .catch((err) => {
              debug(
                "an error has occurred while deleting the subscription: %s",
                err.message
              );
            }),
        ]);
      }
    };

    return adapter;
  };
}

export class PubSubAdapter extends ClusterAdapterWithHeartbeat {
  private readonly sender: ServiceBusSender;
  /**
   * Adapter constructor.
   *
   * @param nsp - the namespace
   * @param sender - a ServiceBus sender
   * @param opts - additional options
   *
   * @public
   */
  constructor(nsp: any, sender: ServiceBusSender, opts: ClusterAdapterOptions) {
    super(nsp, opts);
    this.sender = sender;
  }

  protected doPublish(message: ClusterMessage): Promise<Offset> {
    return this.sender
      .sendMessages({
        body: encode(message),
        applicationProperties: {
          nsp: this.nsp.name,
          uid: this.uid,
        },
      })
      .then();
  }

  protected doPublishResponse(
    requesterUid: ServerId,
    response: ClusterResponse
  ): Promise<void> {
    return this.sender
      .sendMessages({
        body: encode(response),
        applicationProperties: {
          nsp: this.nsp.name,
          uid: this.uid,
          requesterUid,
        },
      })
      .then();
  }

  public onRawMessage(rawMessage: ServiceBusMessage) {
    if (rawMessage.applicationProperties!["uid"] === this.uid) {
      debug("ignore message from self");
      return;
    }

    const requesterUid = rawMessage.applicationProperties!["requesterUid"];
    if (requesterUid && requesterUid !== this.uid) {
      debug("ignore response for another node");
      return;
    }

    const decoded = decode(rawMessage.body);
    debug("received %j", decoded);

    if (requesterUid) {
      this.onResponse(decoded as ClusterResponse);
    } else {
      this.onMessage(decoded as ClusterMessage);
    }
  }
}
