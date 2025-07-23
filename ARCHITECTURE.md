
# Mediasoup Project Architecture

## Overview

The architecture is designed to handle multiple rooms (MainRoom), where each room can have multiple sub-rooms (SubRoom). Each SubRoom has its own Mediasoup Router and a set of connected Peers. The system also supports piping media between different sub-rooms and across servers via pipeTransport.

```
MainRoom
├── SubRoom[]
│   ├── Router
│   └── Peer[]
│       ├── Producer[]
│       └── Consumer[]
├── PipeTransport[]
└── PipeManagerREST
```

---

## BaseRoom Class

This abstract class is extended by both MainRoom and SubRoom.

- Manages `pipeTransports` per `remoteServerId`
- Maintains `pipedConsumers` to avoid duplicate consumers
- `pipeProducerTo()` method handles piping logic
- `createPipeTransport()` for lazy transport creation
- `close()` handles cleanup

---

## MainRoom Class

- Holds map of subRooms
- Lazily initializes subRooms on demand
- `pipeProducerToOtherSubRooms()` pipes a producer to other subRooms
- `pipeProducerToRemoteServer()` handles cross-server piping via PipeManagerREST

---

## SubRoom Class

- Manages Peers in the subRoom
- Holds a dedicated Router
- Has `init()` method for initializing router
- `addPeer()` and `removePeer()` to manage participants

---

## Peer Class

- Manages transports, producers, and consumers
- `addTransport()`, `connectTransport()` for transport handling
- `createProducer()`, `createConsumer()` for media flow
- `closeProducer()`, `close()` for cleanup
- Fully cleans up all media objects on peer exit

---

## PipeManagerREST & RemotePipeController

- `PipeManagerREST` handles outgoing pipe requests via HTTP
- `RemotePipeController` receives pipe requests via endpoints:
  - `/pipe/create`
  - `/pipe/connect`
  - `/pipe/pipe-producer`

---

## Media Flow

1. A peer joins a SubRoom and produces media.
2. MainRoom pipes that producer to other SubRooms using `pipeProducerToOtherSubRooms()`.
3. The receiving SubRooms consume that producer.
4. If needed, the MainRoom pipes the producer to other servers via `pipeProducerToRemoteServer()`.
