### Run Local
For local implementation, nodemon package must be installed first

> npm install -g nodemon

next

> npm run myhost

---
### winston-sentry vs winston-sentry-log vs winston-transport-sentry vs winston-transport-sentry-node
[NPM Trends ](https://npmtrends.com/winston-sentry-vs-winston-sentry-log-vs-winston-transport-sentry-vs-winston-transport-sentry-node)

---
## APIDOC
## Just remember to use this package locally on your system.

Install
> npm install apidoc -g

Run
> apidoc -i . -o apidoc

[Documentation](https://apidocjs.com)

---

# **Linux Kernel Optimizations for Mediasoup (WebRTC)**

This document explains the `sysctl.conf` settings used to optimize Linux networking and system performance for real-time media streaming.

## **🔹 Increase UDP and TCP Buffer Sizes**
```sh
net.core.rmem_max=67108864
net.core.wmem_max=67108864
```
- **`rmem_max` (Receive Buffer Maximum Size)**: Sets the maximum buffer size for receiving UDP/TCP packets (64MB).  
- **`wmem_max` (Send Buffer Maximum Size)**: Sets the maximum buffer size for sending UDP/TCP packets (64MB).  

✅ **Why?** Increases bandwidth capacity, reducing packet loss in high-throughput WebRTC sessions.

---

## **🔹 Set Default UDP Buffer Sizes**
```sh
net.core.rmem_default=262144
net.core.wmem_default=262144
```
- **`rmem_default` (Default Receive Buffer Size)**: Default memory allocation for incoming UDP packets (256KB).  
- **`wmem_default` (Default Send Buffer Size)**: Default memory allocation for outgoing UDP packets (256KB).  

✅ **Why?** Helps maintain stable audio/video quality by preventing buffer underruns.

---

## **🔹 Optimize UDP Memory Allocation**
```sh
net.ipv4.udp_mem=2097152 4194304 8388608
net.ipv4.udp_rmem_min=1048576
net.ipv4.udp_wmem_min=1048576
```
- **`udp_mem` (UDP Memory Limits)**: Controls system-wide UDP buffer allocation:  
  - **Low threshold**: `2097152` (2MB)  
  - **Pressure threshold**: `4194304` (4MB)  
  - **High threshold**: `8388608` (8MB, starts dropping packets beyond this).  
- **`udp_rmem_min` (Minimum Receive Buffer for UDP)**: Ensures at least **1MB** for incoming UDP packets.  
- **`udp_wmem_min` (Minimum Send Buffer for UDP)**: Ensures at least **1MB** for outgoing UDP packets.  

✅ **Why?** Prevents packet drops and improves video/audio transmission reliability.

---

## **🔹 Set Fair Queueing and TCP Congestion Control**
```sh
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
```
- **`default_qdisc=fq` (Fair Queueing Scheduler)**: Prioritizes interactive traffic (like video calls) over bulk data transfers.  
- **`tcp_congestion_control=bbr` (TCP BBR Algorithm)**: Enhances bandwidth estimation and reduces latency for WebRTC.  

✅ **Why?** Improves latency and prevents network congestion during video conferencing.

---

## **🔹 Enable IP Forwarding for Packet Routing**
```sh
net.ipv4.ip_forward=1
```
- **`ip_forward=1`**: Allows the server to forward network packets between interfaces.  

✅ **Why?** Essential for relaying WebRTC traffic in multi-interface setups.

---

## **🔹 Reduce Swap Usage for Better Performance**
```sh
vm.swappiness=0
```
- **`swappiness=0`**: Prevents the system from aggressively swapping memory to disk.  

✅ **Why?** Keeps WebRTC media processing in RAM for lower latency.

---

### **📌 Final Thoughts**
These settings ensure **higher network throughput, lower packet loss, and reduced latency**, making them ideal for real-time **Mediasoup/WebRTC** applications.

---

##
powerpoint
https://docs.google.com/presentation/d/1kALZsa-p2snOucPa79BGdS_pe5IR_YfWGJfDXzybCtY/edit?usp=sharing