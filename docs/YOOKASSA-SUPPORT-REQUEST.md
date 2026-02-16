# Для поддержки ЮKassa: лог запроса к нашему API и ответ вашего API

**Наш API (бэкенд продавца):**  
`POST https://api.runafinance.online/api/payments/create`

Запрос на оплату приходит именно на этот эндпоинт. Наш сервер принимает его, проверяет данные и затем сам вызывает API ЮKassa для создания платежа.

---

**Лог на нашем сервере** (запрос пришёл к нам, мы вызвали ваш API, получили ошибку):

```
[PaymentsController] [payments/create] body keys: planId, emailOrId, returnUrl, cancelUrl, planId=6months, returnUrl=ok, emailOrId=***
[PaymentsService] [YooKassa] Запрос на создание платежа: planId=6months, emailOrId=19
[PaymentsService] [YooKassa] Пользователь найден: userId=19, email=... Создаём платёж planId=6months
[PaymentsService] [YooKassa] Ошибка создания платежа: code=invalid_credentials, description=Error in shopId or secret key. Check their validity. You can reissue the key in the Merchant Profile, planId=6months, email=...
```

То есть: запрос к **нашему** API прошёл, мы сформировали запрос к **API ЮKassa** и получили от вашего API ответ с ошибкой.

---

**Идентификатор ошибки, который вернул ваш API нашему серверу:**

- **code:** `invalid_credentials`
- **description:** `Error in shopId or secret key. Check their validity. You can reissue the key in the Merchant Profile.`

---

**Ответ, который наш API отдаёт клиенту при этой ошибке:**  
HTTP **400 Bad Request**, в теле сообщение: «Оплата временно недоступна. Обратитесь в поддержку.»

Учётные данные (Shop ID и секретный ключ) в нашем .env указаны верно и соответствуют личному кабинету. Нужна проверка с вашей стороны: почему для этих учётных данных возвращается `invalid_credentials`.
