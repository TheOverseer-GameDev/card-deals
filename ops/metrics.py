"""Persist cost, hold, and return only from sourced fields. Missing stays missing."""


def _finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float('inf'), float('-inf')):
        return None
    return number


def sourced_cost(row):
    places = [row.get('lr'), ((row.get('retained_offers') or {}).get('lr'))]
    for place in places:
        if not isinstance(place, dict) or place.get('cad_total_estimated'):
            continue
        number = _finite(place.get('cad_total'))
        if number is not None and number > 0:
            return number
    return None


def emit_metrics(row):
    """Never fill cost from raw * fx. Hold and return stay absent until sourced."""
    cost = sourced_cost(row or {})
    if cost is None:
        return {}
    out = {'cost_cad': round(cost, 2)}
    if row.get('hold_sourced') is not True:
        return out
    hold = _finite(row.get('hold_cad'))
    ret = _finite(row.get('ret_pct'))
    if hold is None or ret is None:
        return out
    out['hold_cad'] = hold
    out['ret_pct'] = ret
    out['exp_return_pct'] = ret
    return out
