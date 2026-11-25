export type AuthMascotMode = 'idle' | 'watching' | 'covered' | 'peeking';

function AuthHandBack() {
  return (
    <>
      <path
        className="sx-auth-hand-back"
        d="M457 327C447 320 440 304 437 287L429 255Q426 245 434 242Q442 239 447 249L457 270L448 232Q446 221 455 219Q464 217 468 229L480 264L472 225Q471 213 480 211Q490 209 493 223L503 260L499 229Q498 217 508 216Q518 215 520 228L524 267L532 251Q537 241 545 246Q553 251 547 262L532 299Q524 321 506 336L493 346L458 340Z"
      />
      <path
        className="sx-auth-nail"
        d="M439 252q4-7 10-3l2 11q-5 3-10-1Zm23-22q4-7 11-3l-1 12q-6 3-11-1Zm24-9q4-7 11-2l-1 12q-6 2-11-1Zm22 19q4-6 10-3l-3 10q-5 3-9-1Z"
      />
      <path
        className="sx-auth-knuckle"
        d="M440 275q7-4 14-2m8-9q7-4 13-2m7-9q7-4 13-1m7 16q6-3 11-1m-65 22q4-4 9-3m9-4q4-4 9-3m9-4q4-4 9-3"
      />
    </>
  );
}

export function AuthMascot({
  restingImage,
  mode,
  typing = false,
}: {
  restingImage: string;
  mode: AuthMascotMode;
  typing?: boolean;
}) {
  return (
    <div
      className="sx-auth-actor"
      data-auth-mascot
      data-mascot-enhanced="true"
      data-mascot-mode={mode}
      data-typing={typing ? 'true' : undefined}
      aria-hidden="true"
    >
      <div className="sx-auth-actor-body">
        <img
          className="sx-auth-character sx-auth-resting"
          src={`/characters/display/384/${restingImage}`}
          alt=""
          draggable="false"
        />
        <img
          className="sx-auth-interactive"
          src="/characters/display/384/deepseek-standing.webp"
          alt=""
          draggable="false"
        />
        <svg
          className="sx-auth-eye-layer"
          viewBox="0 0 1122 2019"
          fill="none"
          focusable="false"
        >
          <defs>
            <clipPath id="auth-privacy-portrait" clipPathUnits="objectBoundingBox">
              <path
                transform="scale(0.0008912656 0.0004952947)"
                clipRule="evenodd"
                d="M0 0H1122V2019H0Z
                   M451 478C432 490 418 514 405 534C386 544 366 571 365 589C369 604 382 616 408 619C402 653 388 677 378 709L318 739L246 725L235 781L136 830L133 896L247 929L376 861L439 799L481 739L477 688L492 631L510 600L484 532Z
                   M735 470C742 485 746 498 750 513C769 532 779 543 775 567C767 582 755 598 733 606C723 618 719 645 720 675C726 694 742 706 756 707C790 694 817 666 845 634L925 605L1061 530L1060 399L835 404L788 495Z"
              />
            </clipPath>
            <radialGradient id="auth-iris-blue">
              <stop offset="0" stopColor="#4263a5" />
              <stop offset=".65" stopColor="#637bbb" />
              <stop offset="1" stopColor="#9dd5ed" />
            </radialGradient>
            <clipPath id="auth-eye-left">
              <ellipse cx="486" cy="284" rx="18" ry="22" transform="rotate(-12 486 284)" />
            </clipPath>
            <clipPath id="auth-eye-right">
              <ellipse cx="584" cy="252" rx="18" ry="22" transform="rotate(-12 584 252)" />
            </clipPath>
          </defs>
          <g clipPath="url(#auth-eye-left)">
            <ellipse cx="486" cy="284" rx="21" ry="25" fill="#fbfcff" />
            <g className="sx-auth-pupils">
              <ellipse cx="486" cy="284" rx="14" ry="22" fill="url(#auth-iris-blue)" />
              <ellipse cx="487" cy="281" rx="5" ry="12" fill="#293c72" />
              <ellipse cx="481" cy="274" rx="4" ry="6" fill="white" />
              <circle cx="491" cy="295" r="2.5" fill="#d5f4ff" />
            </g>
          </g>
          <g clipPath="url(#auth-eye-right)">
            <ellipse cx="584" cy="252" rx="21" ry="25" fill="#fbfcff" />
            <g className="sx-auth-pupils">
              <ellipse cx="584" cy="252" rx="14" ry="22" fill="url(#auth-iris-blue)" />
              <ellipse cx="585" cy="249" rx="5" ry="12" fill="#293c72" />
              <ellipse cx="579" cy="242" rx="4" ry="6" fill="white" />
              <circle cx="589" cy="263" r="2.5" fill="#d5f4ff" />
            </g>
          </g>
          <g className="sx-auth-blink">
            <ellipse cx="486" cy="284" rx="30" ry="25" transform="rotate(-12 486 284)" fill="#ffe3da" />
            <path d="M463 285q22 13 44-10" stroke="#65506b" strokeWidth="5" strokeLinecap="round" />
            <ellipse cx="584" cy="252" rx="30" ry="25" transform="rotate(-12 584 252)" fill="#ffe3da" />
            <path d="M562 253q22 13 44-10" stroke="#65506b" strokeWidth="5" strokeLinecap="round" />
          </g>
          <g className="sx-auth-peek-blush">
            <ellipse cx="455" cy="324" rx="23" ry="8" fill="#f8b2bf" />
            <ellipse cx="612" cy="291" rx="21" ry="8" fill="#f8b2bf" />
          </g>
        </svg>
        <svg
          className="sx-auth-cover-hands"
          viewBox="0 0 1122 2019"
          fill="none"
          focusable="false"
        >
          <defs>
            <linearGradient id="auth-sleeve-navy" x2="1" y2="1">
              <stop stopColor="#444a74" />
              <stop offset=".54" stopColor="#303653" />
              <stop offset="1" stopColor="#222a4a" />
            </linearGradient>
            <linearGradient id="auth-hand-back" x2=".82" y2="1">
              <stop stopColor="#fff0e6" />
              <stop offset=".65" stopColor="#ffded3" />
              <stop offset="1" stopColor="#edb3b5" />
            </linearGradient>
          </defs>
          <g className="sx-auth-arm sx-auth-arm-left">
            <g transform="rotate(-11.1 390 520)">
              <path className="sx-auth-sleeve" d="M449 494C435 531 413 555 391 550C358 542 348 511 361 481L469 356L523 361L438 441C455 451 462 471 449 494Z" />
              <path className="sx-auth-sleeve-fold" d="M377 484q25-31 72-84m-60 122q23-4 34-33m3-36q-21 15-31 22" />
              <g transform="translate(495 368.5) rotate(33.2) translate(-495 -368.5)">
                <g transform="translate(0 31) translate(496.5 343) scale(0.8) translate(-496.5 -343)">
                  <g transform="translate(972 0) scale(-1 1)"><AuthHandBack /></g>
                </g>
                <path className="sx-auth-cuff" d="M467 368l3-29q7-5 14 0q8-6 15-1q9-5 16 0q8-3 10 4l-3 34q-29 5-55-8Z" />
                <path className="sx-auth-cuff-seam" d="M469 365q24 9 52 7" />
              </g>
            </g>
          </g>
          <g className="sx-auth-arm sx-auth-arm-right">
            <g transform="rotate(11.5 735 505)">
              <path className="sx-auth-sleeve" d="M673 490C694 517 725 529 740 505C750 488 740 455 724 431L598 329L547 343L640 442C647 459 657 477 673 490Z" />
              <path className="sx-auth-sleeve-fold" d="M726 490q-28-34-55-56m-2 26q7 17 23 28m-52-71q-20-32-58-60" />
              <g transform="translate(579.5 335.5) rotate(-42.3) translate(-579.5 -335.5)">
                <g transform="translate(0 30) translate(573.5 311) scale(0.8) translate(-573.5 -311)">
                  <g transform="translate(98 -32)"><AuthHandBack /></g>
                </g>
                <path className="sx-auth-cuff" d="M552 348l-8-33q3-8 11-7q5-7 14-5q5-8 15-5q7-5 13 0l12 33q-25 14-57 17Z" />
                <path className="sx-auth-cuff-seam" d="M553 344q25-3 53-17" />
              </g>
            </g>
          </g>
        </svg>
        <span className="sx-auth-peek-label">偷瞄一下 ✧</span>
        <span className="sx-auth-mood-star">✧</span>
      </div>
    </div>
  );
}
