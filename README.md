# Socket.IO Azure Service Bus adapter

The `@socket.io/azure-service-bus-adapter` package allows broadcasting packets between multiple Socket.IO servers.

**Table of contents**

- [Supported features](#supported-features)
- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [License](#license)

## Supported features

| Feature                         | `socket.io` version | Support                                        |
|---------------------------------|---------------------|------------------------------------------------|
| Socket management               | `4.0.0`             | :white_check_mark: YES (since version `0.1.0`) |
| Inter-server communication      | `4.1.0`             | :white_check_mark: YES (since version `0.1.0`) |
| Broadcast with acknowledgements | `4.5.0`             | :white_check_mark: YES (since version `0.1.0`) |
| Connection state recovery       | `4.6.0`             | :x: NO                                         |

## Installation

```
npm install @socket.io/azure-service-bus-adapter
```

## Usage

```js
import { ServiceBusClient, ServiceBusAdministrationClient } from "@azure/service-bus";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/azure-service-bus-adapter";

const connectionString = "Endpoint=...";

const serviceBusClient = new ServiceBusClient(connectionString);
const serviceBusAdminClient = new ServiceBusAdministrationClient(connectionString);

const io = new Server({
  adapter: createAdapter(serviceBusClient, serviceBusAdminClient)
});

// wait for the creation of the pub/sub subscription
await io.of("/").adapter.init();

io.listen(3000);
```

## Options

| Name                 | Description                                                                                            | Default value |
|----------------------|--------------------------------------------------------------------------------------------------------|---------------|
| `topicName`          | The name of the topic.                                                                                 | `socket.io`   |
| `topicOptions`       | The options used to create the topic.                                                                  | `-`           |
| `subscriptionPrefix` | The prefix of the subscription (one subscription will be created per Socket.IO server in the cluster). | `socket.io`   |
| `receiverOptions`    | The options used to create the subscription.                                                           | `-`           |
| `topicOptions`       | The options used to create the receiver.                                                               | `-`           |
| `heartbeatInterval`  | The number of ms between two heartbeats.                                                               | `5_000`       |
| `heartbeatTimeout`   | The number of ms without heartbeat before we consider a node down.                                     | `10_000`      |

## License

[MIT](LICENSE)
