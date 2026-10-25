pragma circom 2.0.0;

// Repair the proof relation itself. A client-side input check would not stop a
// prover that calls the proving backend directly; these equations do.
template XorRepaired() {
    signal input a;
    signal input b;
    signal output out;

    a * (a - 1) === 0;
    b * (b - 1) === 0;
    out <== a + b - 2 * a * b;
}

component main {public [a, b]} = XorRepaired();
