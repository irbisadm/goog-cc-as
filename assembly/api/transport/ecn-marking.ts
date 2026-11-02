// Port of api/transport/ecn_marking.h @ M154.

// TODO: (bugs.webrtc.org/42225697) L4S support is slowly being developed.
// Help is appreciated.

// L4S Explicit Congestion Notification (ECN) .
// https://www.rfc-editor.org/rfc/rfc9331.html ECT stands for ECN-Capable
// Transport and CE stands for Congestion Experienced.

// RFC-3168, Section 5
// +-----+-----+
// | ECN FIELD |
// +-----+-----+
//   ECT   CE         [Obsolete] RFC 2481 names for the ECN bits.
//    0     0         Not-ECT
//    0     1         ECT(1)
//    1     0         ECT(0)
//    1     1         CE

export enum EcnMarking {
  kNotEct = 0b00, // Not ECN-Capable Transport
  kEct1 = 0b01,   // ECN-Capable Transport
  kEct0 = 0b10,   // Not used by L4S (or webrtc.)
  kCe = 0b11,     // Congestion experienced
}
