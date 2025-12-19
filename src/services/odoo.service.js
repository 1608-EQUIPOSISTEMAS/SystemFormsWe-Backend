import { config } from '../config/env.js'

class OdooService {
  constructor() {
    this.baseUrl = config.odoo.url
    this.db = config.odoo.db
    this.login = config.odoo.login
    this.password = config.odoo.password
    this.sessionId = null
  }

  // ═══════════════════════════════════════
  // AUTENTICACIÓN
  // ═══════════════════════════════════════
  async authenticate() {
    try {
      const response = await fetch(`${this.baseUrl}/web/session/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: {
            db: this.db,
            login: this.login,
            password: this.password
          }
        })
      })

      const data = await response.json()
      
      if (data.error) {
        throw new Error(data.error.message || 'Error de autenticación Odoo')
      }

      const cookies = response.headers.get('set-cookie')
      if (cookies) {
        const match = cookies.match(/session_id=([^;]+)/)
        if (match) this.sessionId = match[1]
      }

      return { ok: true, uid: data.result?.uid }
    } catch (error) {
      console.error('Odoo Auth Error:', error.message)
      return { ok: false, error: error.message }
    }
  }

  // ═══════════════════════════════════════
  // LLAMADA GENÉRICA A ODOO
  // ═══════════════════════════════════════
  async call(model, method, args = [], kwargs = {}) {
    if (!this.sessionId) {
      const auth = await this.authenticate()
      if (!auth.ok) return auth
    }

    try {
      const response = await fetch(`${this.baseUrl}/web/dataset/call_kw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `session_id=${this.sessionId}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: { model, method, args, kwargs }
        })
      })

      const data = await response.json()

      if (data.error) {
        if (data.error.message?.includes('Session') || data.error.message?.includes('session')) {
          this.sessionId = null
          return this.call(model, method, args, kwargs)
        }
        throw new Error(data.error.data?.message || data.error.message)
      }

      return { ok: true, result: data.result }
    } catch (error) {
      console.error(`Odoo Call Error [${model}.${method}]:`, error.message)
      return { ok: false, error: error.message }
    }
  }

  // ═══════════════════════════════════════
  // VALIDAR ESTUDIANTE POR EMAIL
  // ═══════════════════════════════════════
  async validateStudent(email) {
    const result = await this.call('res.users', 'search_read', [], {
      domain: [['login', '=', email.toLowerCase().trim()]],
      fields: ['id', 'name', 'login', 'partner_id'],
      context: { website_id: 1 },
      limit: 1
    })

    if (!result.ok) return result

    if (!result.result || result.result.length === 0) {
      return { 
        ok: false, 
        error: 'No estás registrado en el campus Virtual. Comunicarse con el area de Finanzas: 943 882 766',
        code: 'NOT_REGISTERED'
      }
    }

    const user = result.result[0]
    
    const partnerResult = await this.call('res.partner', 'search_read', [], {
      domain: [['id', '=', user.partner_id[0]]],
      fields: ['id', 'name', 'names', 'surnames', 'email'],
      limit: 1
    })

    if (!partnerResult.ok || !partnerResult.result?.length) {
      return { ok: false, error: 'Error al obtener datos del estudiante' }
    }

    const partner = partnerResult.result[0]

    return {
      ok: true,
      student: {
        user_id: user.id,
        partner_id: partner.id,
        email: user.login,
        full_name: partner.name,
        names: partner.names || partner.name?.split(' ')[0] || '',
        surnames: partner.surnames || ''
      }
    }
  }

  // ═══════════════════════════════════════
  // OBTENER INFO DEL CURSO
  // ═══════════════════════════════════════
  async getCourseInfo(courseName) {
    const result = await this.call('slide.channel', 'search_read', [], {
      domain: [['name', 'ilike', courseName]],
      fields: ['id', 'name', 'academic_hours', 'course_type'],
      limit: 1
    })

    if (!result.ok) return result

    if (!result.result || result.result.length === 0) {
      return { ok: false, error: `Curso "${courseName}" no encontrado en Odoo` }
    }

    return { ok: true, course: result.result[0] }
  }

  // ═══════════════════════════════════════
  // ACTIVAR ALUMNO
  // ═══════════════════════════════════════
  async activateStudent(partnerId, names) {
    const result = await this.call('res.partner', 'write', [
      [partnerId],
      { verified_data: true, names: names }
    ])
    return result
  }

  // ═══════════════════════════════════════
  // CREAR CERTIFICADO
  // ═══════════════════════════════════════
  async createCertificate(data) {
    const result = await this.call('issued.certificates', 'create', [data])
    if (!result.ok) return result
    return { ok: true, certificate_id: result.result }
  }

  // ═══════════════════════════════════════
  // VALIDAR CERTIFICADO
  // ═══════════════════════════════════════
  async validateCertificate(certificateId) {
    const result = await this.call('issued.certificates', 'validate', [[certificateId]])
    return result
  }

  // ═══════════════════════════════════════
  // GENERAR PDF DEL CERTIFICADO
  // ═══════════════════════════════════════
  async generateCertificatePdf(certificateId) {
    console.log('📄 Llamando action_generate_certificate con ID:', certificateId)
    const result = await this.call('issued.certificates', 'action_generate_certificate', [[certificateId]])
    return result
  }

  // ═══════════════════════════════════════
  // OBTENER DATOS DEL CERTIFICADO
  // ═══════════════════════════════════════
  async getCertificateData(certificateId) {
    const result = await this.call('issued.certificates', 'search_read', [], {
      domain: [['id', '=', certificateId]],
      fields: ['id', 'state', 'code', 'pdf_certificate_file']
    })

    if (!result.ok) return result

    if (!result.result || result.result.length === 0) {
      return { ok: false, error: 'Certificado no encontrado' }
    }

    const cert = result.result[0]
    
    console.log('📄 Certificado ID:', cert.id, 'State:', cert.state, 'Code:', cert.code)

    // Verificar si tiene PDF
    const hasPdf = cert.pdf_certificate_file && 
                  typeof cert.pdf_certificate_file === 'string' && 
                  cert.pdf_certificate_file !== 'false' &&
                  cert.pdf_certificate_file.length > 100

    // Si tiene contenido base64, usar URL de descarga directa de Odoo
    const pdfUrl = `${this.baseUrl}/web/content/issued.certificates/${cert.id}/pdf_certificate_file?download=true`

    return {
      ok: true,
      certificate: {
        id: cert.id,
        pdf_url: pdfUrl,
        state: cert.state,
        code: cert.code || null,
        has_pdf: hasPdf
      }
    }
  }

  async getCertificatePdfBase64(certificateId) {
  try {
    const result = await this.call('issued.certificates', 'search_read', [], {
      domain: [['id', '=', certificateId]],
      fields: ['pdf_certificate_file']
    })

    if (!result.ok || !result.result || result.result.length === 0) {
      console.error('❌ No se encontró el certificado:', certificateId)
      return null
    }

    const pdfField = result.result[0].pdf_certificate_file

    // Verificar si tiene contenido válido
    if (!pdfField || pdfField === 'false' || typeof pdfField !== 'string') {
      console.error('❌ El certificado no tiene PDF generado')
      return null
    }

    // El campo pdf_certificate_file contiene el PDF en base64
    console.log('✅ PDF base64 obtenido, longitud:', pdfField.length)
    return pdfField

  } catch (error) {
    console.error('❌ Error obteniendo PDF de Odoo:', error)
    return null
  }
}

  // ═══════════════════════════════════════
  // PROCESO COMPLETO DE CERTIFICACIÓN
  // ═══════════════════════════════════════
  async certifyStudent(studentData, examData) {
    try {
      console.log('🎓 Iniciando certificación en Odoo...')
      console.log('   Estudiante:', studentData)
      console.log('   Examen:', examData)

      // 1. Obtener info del curso
      const courseResult = await this.getCourseInfo(examData.course_name)
      if (!courseResult.ok) {
        console.error('❌ Error obteniendo curso:', courseResult.error)
        return courseResult
      }

      const course = courseResult.course
      console.log('✓ Curso encontrado:', course)

      // 2. Activar alumno
      const activateResult = await this.activateStudent(studentData.partner_id, studentData.names)
      if (!activateResult.ok) {
        console.warn('⚠️ Error activando alumno (continuando):', activateResult.error)
      } else {
        console.log('✓ Alumno activado')
      }

      // 3. Crear certificado
      const today = new Date().toISOString().split('T')[0]
      const completionDate = examData.completion_date 
        ? examData.completion_date.split('T')[0] 
        : today

      const certData = {
        slide_channel_id: course.id,
        course_type: course.course_type || 'online_ind',
        slide_channel_name: course.name,
        academic_hours: course.academic_hours || 24,
        date_issue: today,
        course_completion_date: completionDate,
        final_score: Math.round(examData.final_score),
        partner_id: studentData.partner_id,
        student_names: (studentData.names || '').toUpperCase(),
        student_surnames: (studentData.surnames || '').toUpperCase()
      }

      console.log('📝 Creando certificado con datos:', certData)

      const createResult = await this.createCertificate(certData)
      if (!createResult.ok) {
        console.error('❌ Error creando certificado:', createResult.error)
        return createResult
      }

      const certificateId = createResult.certificate_id
      console.log('✓ Certificado creado, ID:', certificateId)

      // 4. Validar certificado
      console.log('🔐 Validando certificado...')
      const validateResult = await this.validateCertificate(certificateId)
      if (!validateResult.ok) {
        console.warn('⚠️ Error validando certificado:', validateResult.error)
      } else {
        console.log('✓ Certificado validado')
      }

      // 5. GENERAR PDF (action_generate_certificate)
      console.log('📄 Generando PDF del certificado...')
      const generateResult = await this.generateCertificatePdf(certificateId)
      if (!generateResult.ok) {
        console.warn('⚠️ Error generando PDF:', generateResult.error)
      } else {
        console.log('✓ PDF generado correctamente')
      }

      // 6. Esperar a que Odoo procese el PDF
      console.log('⏳ Esperando procesamiento del PDF...')
      await new Promise(resolve => setTimeout(resolve, 4000))

      // 7. Obtener datos del certificado con URL del PDF
      const certResult = await this.getCertificateData(certificateId)
      if (!certResult.ok) {
        console.error('❌ Error obteniendo certificado:', certResult.error)
        return {
          ok: true,
          certificate: {
            id: certificateId,
            pdf_url: `${this.baseUrl}/web/content/issued.certificates/${certificateId}/pdf_certificate_file?download=true`,
            code: null
          }
        }
      }

      console.log('✓ Certificado completo:', certResult.certificate)

      // Verificar si realmente tiene PDF
      if (!certResult.certificate.has_pdf) {
        console.warn('⚠️ El certificado no tiene PDF aún, usando URL directa')
      }

      return {
        ok: true,
        certificate: {
          id: certificateId,
          pdf_url: certResult.certificate.pdf_url,
          code: certResult.certificate.code
        }
      }
    } catch (error) {
      console.error('❌ Certification Error:', error)
      return { ok: false, error: error.message }
    }
  }

  // ═══════════════════════════════════════
// VERIFICAR INSCRIPCIÓN EN CURSO
// ═══════════════════════════════════════
async checkCourseEnrollment(partnerId, slideChannelId, courseName = null) {
  if (!slideChannelId && !courseName) {
    console.log('⚠️ No hay slide_channel_id ni course_name, saltando validación')
    return { ok: true, enrolled: true, skipped: true }
  }

  console.log('🔍 Verificando inscripción:', { partnerId, slideChannelId, courseName })

  const allCourses = await this.call('report.slide.channel.progress', 'search_read', [], {
    domain: [['partner_id', '=', partnerId]],
    fields: ['channel_id', 'progress'],
    context: { website_id: 1 },
    limit: 100
  })

  if (!allCourses.ok) {
    return { ok: false, error: 'Error al verificar inscripción en el curso' }
  }

  // Buscar por ID o por nombre
  const enrollment = allCourses.result?.find(course => {
    const courseId = Array.isArray(course.channel_id) ? course.channel_id[0] : course.channel_id
    const courseNameOdoo = Array.isArray(course.channel_id) ? course.channel_id[1] : ''
    
    // Coincide por ID O por nombre (case-insensitive)
    return courseId === slideChannelId || 
           (courseName && courseNameOdoo.toLowerCase().includes(courseName.toLowerCase()))
  })

  if (!enrollment) {
    console.log('❌ No inscrito. Cursos disponibles:', 
      allCourses.result?.map(c => `${c.channel_id[0]}: ${c.channel_id[1]}`)
    )
    return { 
      ok: false, 
      enrolled: false,
      error: 'No estás inscrito en este curso. Por favor, inscríbete primero en el Campus Virtual.',
      code: 'NOT_ENROLLED'
    }
  }

  console.log('✅ Inscrito en:', enrollment.channel_id)
  return { ok: true, enrolled: true, progress: enrollment.progress }
}
// ═══════════════════════════════════════
// VALIDAR ESTUDIANTE CON INSCRIPCIÓN
// ═══════════════════════════════════════
async validateStudentWithEnrollment(email, slideChannelId = null, courseName = null) {
  const studentResult = await this.validateStudent(email)
  if (!studentResult.ok) return studentResult

  if (slideChannelId || courseName) {
    const enrollmentResult = await this.checkCourseEnrollment(
      studentResult.student.partner_id, 
      slideChannelId,
      courseName  // Pasar también el nombre
    )
    if (!enrollmentResult.ok) return enrollmentResult
    studentResult.student.course_progress = enrollmentResult.progress || 0
  }

  return studentResult
}
}

export const odooService = new OdooService()