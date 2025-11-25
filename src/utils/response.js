// Respuestas estandarizadas
export const success = (data = null, message = 'Operación exitosa') => ({
  ok: true,
  message,
  data
})

export const error = (message = 'Error', code = 'ERROR', details = null) => ({
  ok: false,
  message,
  code,
  ...(details && { details })
})

export const paginated = (items, page, limit, total) => ({
  ok: true,
  data: {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  }
})