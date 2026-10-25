pragma circom 2.0.0;

// The arithmetic XOR polynomial is correct only when a and b are bits.
// This intentionally weak relation omits those application preconditions so
// the lesson can prove an explicit phantom output against the real backend.
template XorWeak() {
    signal input a;
    signal input b;
    signal output out;

    out <== a + b - 2 * a * b;
}

// Expose the example inputs so the verifier sees the exact unintended
// assignment rather than trusting a teaching-only view of a private witness.
component main {public [a, b]} = XorWeak();
