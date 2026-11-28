contract Counter {
    storage: Storage
    incomingMessages: Increment | Reset
}
type Command = Increment | Reset
struct Box<X> { value: X }
struct Storage { count: Box<uint32>; body: Command; note: Cell<Note>? }
enum Phase: uint8 { idle = 1, done = 7 }
struct Note { text: string; amount: varuint16; balances: map<uint16, uint32>; phase: Phase }
struct (0x42) Increment { delta: int16; previous: cell }
struct (0x43) Reset { enabled: bool }
fun onInternalMessage() {}
get fun currentCount(): uint32 { return 7 }
