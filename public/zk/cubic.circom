pragma circom 2.0.0;

// Proves knowledge of a secret x such that x^3 + x + 5 = out.
// x is a private input; out is a public output (the verifier sees only out).
template Cubic() {
    signal input x;
    signal output out;
    signal v1;
    signal v2;
    v1 <== x * x;     // first multiplication gate
    v2 <== v1 * x;    // second multiplication gate
    out <== v2 + x + 5;
}

component main = Cubic();
