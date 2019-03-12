import { Connection, PacketWriter, PacketReader, State } from "mcproto"
import { createServer } from "net"

const PROXY_PORT = 25565

const host = "2b2t.org"
const port = 25565

const displayName = process.env.DISPLAY_NAME!
if (!displayName) console.error("Specify DISPLAY_NAME, ACCESS_TOKEN and PROFILE environment variables"), process.exit()

Connection.connect(host, port, {
    accessToken: process.env.ACCESS_TOKEN,
    profile: process.env.PROFILE
}).then(async conn => {
    conn.send(new PacketWriter(0x0).writeVarInt(340)
        .writeString(host).writeUInt16(port).writeVarInt(2))

    conn.send(new PacketWriter(0x0).writeString(displayName))

    const loginStart = await new Promise<PacketReader>((res, rej) => {
        conn.onLogin = res, conn.onClose = rej
    })

    const uuid = loginStart.readString(), username = loginStart.readString()

    const packets: PacketReader[] = []

    const onPacket = (packet: PacketReader) => {
        switch (packet.id) {
            case 0x1f: return
            case 0x2f: {
                const teleportId = (packet.read(3 * 8 + 2 * 4 + 1), packet.readVarInt())
                conn.send(new PacketWriter(0x0).writeVarInt(teleportId))
                return
            }
        }
        packets.push(packet)
    }

    conn.onPacket = onPacket

    let connected = false

    createServer(async socket => {
        const client = new Connection(socket, { isServer: true })

        await client.nextPacket()

        if (client.state == State.Login) {
            if (connected) return client.disconnect()
            connected = true
            await client.nextPacket()
            client.send(new PacketWriter(0x2).writeString(uuid).writeString(username))
            await new Promise(res => setTimeout(res, 100))

            for (const packet of packets) client.send(packet)

            client.onPacket = packet => {
                if (packet.id == 0xb) return
                if (packet.id == 0x0) return
                conn.send(packet)
            }

            conn.onPacket = packet => (onPacket(packet), client.send(packet))

            client.onClose = () => {
                conn.onPacket = onPacket
                connected = false
            }
        } else {
            const response = {
                description: `${packets.length} packets`,
                players: { online: connected ? 1 : 0, max: 1 },
                version: { name: "1.12.2", protocol: 340 }
            }
            client.onPacket = packet => {
                if (packet.id == 0x0) {
                    client.send(new PacketWriter(0x0).writeJSON(response))
                } else if (packet.id == 0x1) {
                    client.send(new PacketWriter(0x1).write(packet.read(8)))
                }
            }
        }
    }).listen(PROXY_PORT)
})
