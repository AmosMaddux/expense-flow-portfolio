export type None = {
    hasData: false;
};

export type Some<T> = {
    hasData: true;
    data: T;
};

export type Results<T> = Some<T> | None;

export function Some<T>(data: T): Some<T> {
    return { hasData: true, data: data };
}

export function None(): None {
    return { hasData: false };
}

export function Results<T>(data?: T): Results<T> {
    if (data === undefined) {
        return { hasData: false };
    } else {
        return { hasData: true, data: data };
    }
}
