#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN="${CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN:-}"
TICKETS="${TICKETS:-}"
DRY_RUN="${DRY_RUN:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" ]]; then
    echo "Refusing to run destructive teardown with AWS_PROFILE=$AWS_PROFILE. Use the dedicated $EXPECTED_PROFILE sandbox profile." >&2
    exit 1
fi

if [[ "$CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN" != "ALL-SCRUM" ]]; then
    echo "Refusing to run ticket teardowns without CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN=ALL-SCRUM." >&2
    exit 1
fi

ticket_selected() {
    local ticket="$1"

    if [[ -z "$TICKETS" ]]; then
        return 0
    fi

    IFS="," read -r -a requested_tickets <<<"$TICKETS"
    for requested_ticket in "${requested_tickets[@]}"; do
        if [[ "$requested_ticket" == "$ticket" ]]; then
            return 0
        fi
    done

    return 1
}

discover_teardown_scripts() {
    local ticket_dir ticket script

    for ticket_dir in "$SCRIPT_DIR"/SCRUM-*; do
        [[ -d "$ticket_dir" ]] || continue
        ticket="$(basename "$ticket_dir")"
        ticket_selected "$ticket" || continue

        for script in "$ticket_dir"/tear-down-*.sh; do
            [[ -f "$script" ]] || continue
            printf "%s\t%s\n" "$ticket" "$script"
        done
    done | sort -r
}

main() {
    local teardown_scripts_found="false"
    local ticket script

    while IFS=$'\t' read -r ticket script; do
        [[ -n "$ticket" && -n "$script" ]] || continue
        teardown_scripts_found="true"

        if [[ "$DRY_RUN" == "true" ]]; then
            echo "Would run $script with CONFIRM_RESOURCE_TEARDOWN=$ticket."
            continue
        fi

        echo "Running $script..."
        CONFIRM_RESOURCE_TEARDOWN="$ticket" \
            AWS_PROFILE="$AWS_PROFILE" \
            AWS_REGION="$AWS_REGION" \
            bash "$script"
    done < <(discover_teardown_scripts)

    if [[ "$teardown_scripts_found" != "true" ]]; then
        echo "No SCRUM ticket teardown scripts were found."
    fi
}

main "$@"
