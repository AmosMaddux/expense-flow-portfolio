import {
    useRef,
    useState,
    type ChangeEvent,
    type FormEvent,
    type KeyboardEvent,
    type ClipboardEvent,
    type ReactNode,
} from "react";

export type SignInValues = {
    email: string;
    password: string;
};

type SignInScreenProps = {
    onSubmit: (values: SignInValues) => Promise<void>;
    onForgotPassword: () => void;
};

/**
 * Collects primary credentials for the ExpenseFlow login flow.
 */
export function SignInScreen({
    onSubmit,
    onForgotPassword,
}: SignInScreenProps): JSX.Element {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            await onSubmit({ email: email.trim(), password });
        } catch {
            setError(
                "We couldn't sign you in. Check your details and try again.",
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthPage
            eyebrow="Enterprise Management System"
            footer="Secure access • AES-256 encrypted"
        >
            <div className="auth-card">
                <div className="auth-card__heading">
                    <h2>Welcome back</h2>
                    <p>Sign in to continue to ExpenseFlow.</p>
                </div>
                <form
                    className="auth-form"
                    onSubmit={(event) => void submit(event)}
                >
                    <div className="field">
                        <label htmlFor="email">Email</label>
                        <input
                            autoComplete="email"
                            id="email"
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="user-a@example.test"
                            required
                            type="email"
                            value={email}
                        />
                    </div>
                    <div className="field">
                        <div className="field__label-row">
                            <label htmlFor="password">Password</label>
                            <button
                                className="text-button"
                                onClick={onForgotPassword}
                                type="button"
                            >
                                Forgot password?
                            </button>
                        </div>
                        <div className="password-field">
                            <input
                                autoComplete="current-password"
                                id="password"
                                onChange={(event) =>
                                    setPassword(event.target.value)
                                }
                                placeholder="••••••••"
                                required
                                type={showPassword ? "text" : "password"}
                                value={password}
                            />
                            <button
                                aria-label={
                                    showPassword
                                        ? "Hide password"
                                        : "Show password"
                                }
                                className="password-field__toggle"
                                onClick={() =>
                                    setShowPassword((visible) => !visible)
                                }
                                type="button"
                            >
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                    </div>
                    {error === null ? null : (
                        <p
                            className="form-message form-message--error"
                            role="alert"
                        >
                            {error}
                        </p>
                    )}
                    <button
                        className="button button--primary"
                        disabled={isSubmitting}
                        type="submit"
                    >
                        {isSubmitting ? "Signing in…" : "Sign in"}
                        <span aria-hidden="true">→</span>
                    </button>
                </form>
                <div className="auth-card__support">
                    Don&apos;t have an account? <strong>Contact IT</strong>
                </div>
            </div>
        </AuthPage>
    );
}

type MfaChallengeScreenProps = {
    email: string;
    onVerify: (totpCode: string) => Promise<void>;
    onBack: () => void;
};

/**
 * Collects and submits a six-digit TOTP challenge.
 */
export function MfaChallengeScreen({
    email,
    onVerify,
    onBack,
}: MfaChallengeScreenProps): JSX.Element {
    const [digits, setDigits] = useState(["", "", "", "", "", ""]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

    const distributeCode = (value: string): void => {
        const code = value.replace(/\D/g, "").slice(0, 6);
        if (code.length === 0) {
            return;
        }

        setDigits(Array.from({ length: 6 }, (_, index) => code[index] ?? ""));
        inputRefs.current[Math.min(code.length, 6) - 1]?.focus();
    };

    const updateDigit = (
        index: number,
        event: ChangeEvent<HTMLInputElement>,
    ): void => {
        const numericValue = event.target.value.replace(/\D/g, "");
        if (numericValue.length > 1) {
            distributeCode(numericValue);
            return;
        }

        const nextDigit = numericValue.slice(-1);
        setDigits((current) =>
            current.map((digit, digitIndex) =>
                digitIndex === index ? nextDigit : digit,
            ),
        );
        if (nextDigit.length === 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (
        index: number,
        event: KeyboardEvent<HTMLInputElement>,
    ): void => {
        if (event.key === "Backspace" && digits[index] === "") {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
        const pastedCode = event.clipboardData.getData("text");
        if (pastedCode.length === 0) {
            return;
        }

        event.preventDefault();
        distributeCode(pastedCode);
    };

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const totpCode = digits.join("");
        if (totpCode.length !== 6) {
            setError("Enter all six digits from your authenticator app.");
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            await onVerify(totpCode);
        } catch {
            setDigits(["", "", "", "", "", ""]);
            inputRefs.current[0]?.focus();
            setError("That code is invalid or expired. Try a new code.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthPage
            eyebrow="Management System"
            footer="Secure access • MFA challenge"
        >
            <div className="auth-card auth-card--centered">
                <div className="mfa-icon" aria-hidden="true">
                    ✓
                </div>
                <div className="auth-card__heading">
                    <h2>Verify your identity</h2>
                    <p>
                        Enter the 6-digit code from your authenticator app for{" "}
                        <strong>{email}</strong>.
                    </p>
                </div>
                <form
                    className="auth-form"
                    onSubmit={(event) => void submit(event)}
                >
                    <div className="digit-group">
                        {digits.map((digit, index) => (
                            <input
                                aria-label={`Digit ${index + 1}`}
                                autoComplete={
                                    index === 0 ? "one-time-code" : "off"
                                }
                                className="digit-input"
                                inputMode="numeric"
                                key={index}
                                maxLength={1}
                                onChange={(event) => updateDigit(index, event)}
                                onKeyDown={(event) =>
                                    handleKeyDown(index, event)
                                }
                                onPaste={handlePaste}
                                ref={(element) => {
                                    inputRefs.current[index] = element;
                                }}
                                value={digit}
                            />
                        ))}
                    </div>
                    {error === null ? null : (
                        <p
                            className="form-message form-message--error"
                            role="alert"
                        >
                            {error}
                        </p>
                    )}
                    <button
                        className="button button--primary"
                        disabled={isSubmitting}
                        type="submit"
                    >
                        {isSubmitting ? "Verifying…" : "Verify"}
                    </button>
                    <div className="auth-form__secondary">
                        <button
                            className="text-button"
                            onClick={onBack}
                            type="button"
                        >
                            ← Back to sign in
                        </button>
                    </div>
                </form>
            </div>
        </AuthPage>
    );
}

type PasswordResetRequestScreenProps = {
    onRequested: () => void;
    onBack: () => void;
};

/**
 * Renders the UI-only password reset request step.
 */
export function PasswordResetRequestScreen({
    onRequested,
    onBack,
}: PasswordResetRequestScreenProps): JSX.Element {
    const [email, setEmail] = useState("");

    return (
        <AuthPage eyebrow="Account recovery" footer="Secure access">
            <div className="auth-card">
                <div className="auth-card__heading">
                    <h2>Reset your password</h2>
                    <p>
                        Enter your work email. This prototype will show the next
                        step without sending a live request.
                    </p>
                </div>
                <form
                    className="auth-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onRequested();
                    }}
                >
                    <div className="field">
                        <label htmlFor="reset-email">Email</label>
                        <input
                            autoComplete="email"
                            id="reset-email"
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="user-a@example.test"
                            required
                            type="email"
                            value={email}
                        />
                    </div>
                    <button className="button button--primary" type="submit">
                        Continue
                    </button>
                    <div className="auth-form__secondary">
                        <button
                            className="text-button"
                            onClick={onBack}
                            type="button"
                        >
                            ← Back to sign in
                        </button>
                    </div>
                </form>
            </div>
        </AuthPage>
    );
}

type PasswordResetConfirmationScreenProps = {
    onBack: () => void;
};

/**
 * Confirms the mocked password reset request without contacting a service.
 */
export function PasswordResetConfirmationScreen({
    onBack,
}: PasswordResetConfirmationScreenProps): JSX.Element {
    return (
        <AuthPage eyebrow="Account recovery" footer="Secure access">
            <div className="auth-card auth-card--centered">
                <div className="confirmation-icon" aria-hidden="true">
                    ✓
                </div>
                <div className="auth-card__heading">
                    <h2>Check your email</h2>
                    <p>
                        If an ExpenseFlow account matches that address, password
                        reset instructions will be available. No email was sent
                        in this mocked flow.
                    </p>
                </div>
                <button
                    className="button button--primary"
                    onClick={onBack}
                    type="button"
                >
                    Return to sign in
                </button>
            </div>
        </AuthPage>
    );
}

type AuthPageProps = {
    eyebrow: string;
    footer: string;
    children: ReactNode;
};

/**
 * Provides the shared prototype-aligned authentication page frame.
 */
function AuthPage({ eyebrow, footer, children }: AuthPageProps): JSX.Element {
    return (
        <main className="auth-page">
            <div className="auth-page__pattern" aria-hidden="true" />
            <div className="auth-container">
                <header className="auth-brand">
                    <div className="brand-mark" aria-hidden="true">
                        EF
                    </div>
                    <h1>ExpenseFlow</h1>
                    <p>{eyebrow}</p>
                </header>
                {children}
                <p className="auth-page__footer">{footer}</p>
            </div>
        </main>
    );
}
