#!/usr/bin/env python3
"""
Безопасная обертка для работы с Tinkoff Invest API.
Используется как микросервис, вызываемый из NestJS backend.
"""
import json
import sys
import os
from typing import Dict, Any
from datetime import datetime, timedelta

# Добавляем путь к SDK (если рядом лежит vendored SDK)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from tinkoff.invest import Client
    from tinkoff.invest.constants import INVEST_GRPC_API, INVEST_GRPC_API_SANDBOX
    from tinkoff.invest import CandleInterval, InstrumentIdType
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Failed to import Tinkoff SDK: {str(e)}"}), file=sys.stderr)
    sys.exit(1)


def _money_value_to_float(money_value) -> float:
    if money_value is None:
        return 0.0
    units = getattr(money_value, "units", 0) or 0
    nano = getattr(money_value, "nano", 0) or 0
    return float(units) + float(nano) / 1e9


def get_portfolio(token: str, use_sandbox: bool = False) -> Dict[str, Any]:
    """Получить портфель пользователя из Tinkoff Invest."""
    try:
        target = INVEST_GRPC_API_SANDBOX if use_sandbox else INVEST_GRPC_API

        with Client(token, target=target) as client:
            accounts_response = client.users.get_accounts()
            if not accounts_response.accounts:
                return {
                    "success": True,
                    "accounts": [],
                    "portfolio": [],
                    "total_value": 0,
                    "total_cost": 0,
                    "total_pnl": 0,
                    "total_pnl_percent": 0,
                }

            account_id = accounts_response.accounts[0].id

            positions_response = client.operations.get_positions(account_id=account_id)

            portfolio_items = []
            total_value = 0.0
            total_cost = 0.0

            if positions_response.securities:
                for position in positions_response.securities:
                    if position.balance <= 0:
                        continue

                    instrument_info = None
                    instrument_type = "OTHER"
                    ticker = position.figi
                    name = "Unknown"

                    # Пробуем акцию
                    try:
                        share = client.instruments.share_by(
                            id_type=InstrumentIdType.INSTRUMENT_ID_TYPE_FIGI,
                            id=position.figi,
                        )
                        if share and share.instrument:
                            instrument_info = share.instrument
                            ticker = instrument_info.ticker
                            name = instrument_info.name
                            instrument_type = "STOCK"
                    except Exception:
                        pass

                    # Пробуем облигацию
                    if not instrument_info:
                        try:
                            bond = client.instruments.bond_by(
                                id_type=InstrumentIdType.INSTRUMENT_ID_TYPE_FIGI,
                                id=position.figi,
                            )
                            if bond and bond.instrument:
                                instrument_info = bond.instrument
                                ticker = instrument_info.ticker
                                name = instrument_info.name
                                instrument_type = "BOND"
                        except Exception:
                            pass

                    # Пробуем ETF
                    if not instrument_info:
                        try:
                            etf = client.instruments.etf_by(
                                id_type=InstrumentIdType.INSTRUMENT_ID_TYPE_FIGI,
                                id=position.figi,
                            )
                            if etf and etf.instrument:
                                instrument_info = etf.instrument
                                ticker = instrument_info.ticker
                                name = instrument_info.name
                                instrument_type = "ETF"
                        except Exception:
                            pass

                    quantity = float(position.balance)

                    # Пытаемся получить текущую цену через last price (упрощённо)
                    current_price = 0.0
                    try:
                        last_prices = client.market_data.get_last_prices(figi=[position.figi])
                        if last_prices and last_prices.last_prices:
                            current_price = _money_value_to_float(last_prices.last_prices[0].price)
                    except Exception:
                        current_price = 0.0

                    # Средняя цена неизвестна без операций — оставляем 0
                    average_price = 0.0
                    total_item_value = quantity * current_price
                    total_value += total_item_value

                    portfolio_items.append(
                        {
                            "figi": position.figi,
                            "ticker": ticker,
                            "name": name,
                            "type": instrument_type,
                            "quantity": quantity,
                            "average_price": average_price,
                            "current_price": current_price,
                            "total_cost": 0.0,
                            "current_value": total_item_value,
                            "pnl": 0.0,
                            "pnl_percent": 0.0,
                        }
                    )

            return {
                "success": True,
                "account_id": account_id,
                "portfolio": portfolio_items,
                "total_value": total_value,
                "total_cost": total_cost,
                "total_pnl": 0.0,
                "total_pnl_percent": 0.0,
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_accounts(token: str, use_sandbox: bool = False) -> Dict[str, Any]:
    try:
        target = INVEST_GRPC_API_SANDBOX if use_sandbox else INVEST_GRPC_API
        with Client(token, target=target) as client:
            accounts_response = client.users.get_accounts()
            accounts = []
            for acc in accounts_response.accounts:
                accounts.append(
                    {
                        "id": acc.id,
                        "type": str(acc.type),
                        "name": acc.name,
                        "status": str(acc.status),
                        "opened_date": acc.opened_date.isoformat() if getattr(acc, "opened_date", None) else None,
                    }
                )
            return {"success": True, "accounts": accounts}
    except Exception as e:
        return {"success": False, "accounts": [], "error": str(e)}


def search_instruments(token: str, query: str, use_sandbox: bool = False) -> Dict[str, Any]:
    try:
        target = INVEST_GRPC_API_SANDBOX if use_sandbox else INVEST_GRPC_API
        with Client(token, target=target) as client:
            resp = client.instruments.find_instrument(query=query)
            instruments = []
            for i in resp.instruments:
                instruments.append(
                    {
                        "figi": i.figi,
                        "ticker": i.ticker,
                        "name": i.name,
                        "type": str(i.instrument_type),
                        "currency": str(i.currency),
                    }
                )
            return {"success": True, "instruments": instruments}
    except Exception as e:
        return {"success": False, "instruments": [], "error": str(e)}


def create_demo_account(token: str) -> Dict[str, Any]:
    # В песочнице создание аккаунта/пополнение зависит от прав токена.
    # Оставляем как best-effort.
    try:
        with Client(token, target=INVEST_GRPC_API_SANDBOX) as client:
            acc = client.sandbox.open_sandbox_account()
            account_id = acc.account_id
            balance = client.sandbox.sandbox_pay_in(
                account_id=account_id,
                amount={"currency": "rub", "units": 1000000, "nano": 0},
            )
            return {"success": True, "account_id": account_id, "balance": {"units": balance.balance.units, "nano": balance.balance.nano, "currency": balance.balance.currency}}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_current_price(token: str, figi: str, use_sandbox: bool = False) -> Dict[str, Any]:
    try:
        target = INVEST_GRPC_API_SANDBOX if use_sandbox else INVEST_GRPC_API
        with Client(token, target=target) as client:
            last_prices = client.market_data.get_last_prices(figi=[figi])
            if not last_prices.last_prices:
                return {"success": False, "error": "No price data"}
            p = last_prices.last_prices[0]
            price = _money_value_to_float(p.price)
            return {"success": True, "price": price, "currency": "RUB"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Command is required"}))
        return

    command = sys.argv[1]
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}

    token = data.get("token")
    use_sandbox = bool(data.get("use_sandbox", False))

    if command == "get_portfolio":
        print(json.dumps(get_portfolio(token, use_sandbox)))
    elif command == "get_accounts":
        print(json.dumps(get_accounts(token, use_sandbox)))
    elif command == "search_instruments":
        print(json.dumps(search_instruments(token, data.get("query", ""), use_sandbox)))
    elif command == "create_demo_account":
        print(json.dumps(create_demo_account(token)))
    elif command == "get_current_price":
        print(json.dumps(get_current_price(token, data.get("figi", ""), use_sandbox)))
    else:
        print(json.dumps({"success": False, "error": f"Unknown command: {command}"}))


if __name__ == "__main__":
    main()

