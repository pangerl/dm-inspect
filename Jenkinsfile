pipeline {
    agent { label 'it-jenkins-agent' }

    parameters {
        gitParameter(
            name: 'BRANCH',
            type: 'PT_BRANCH',
            defaultValue: 'main',
            description: '请选择要构建的分支',
            branchFilter: '(.*)',
            sortMode: 'ASCENDING_SMART',
            selectedValue: 'DEFAULT'
        )
        gitParameter(
            name: 'TAG',
            type: 'PT_TAG',
            defaultValue: '',
            description: '请选择标签进行打包。注意：【如果不为空，则优先使用此处选中的标签进行构建】',
            sortMode: 'DESCENDING_SMART',
            selectedValue: 'NONE'
        )
    }

    environment {
        // --- Docker 仓库配置 ---
        DOCKER_REGISTRY_DOMAIN = "crpi-ic1ao4fqbusgeli6.cn-hangzhou.personal.cr.aliyuncs.com"
        DOCKER_REGISTRY_URL = "https://crpi-ic1ao4fqbusgeli6.cn-hangzhou.personal.cr.aliyuncs.com"
        IMAGE_NAMESPACE = "data-match"
        DOCKER_REGISTRY_CREDENTIALS_ID = "docker-registry-cred"

        // --- 项目基础配置 ---
        SERVICE_NAME = 'dm-inspect'
        CURRENT_IMAGE_NAME_BASE = "${DOCKER_REGISTRY_DOMAIN}/${IMAGE_NAMESPACE}/${SERVICE_NAME}"

        // --- 回调接口配置 ---
        WEBHOOK_KEY = "07855d5b-d0db-46ee-b7a6-3b65e0106afe"
        WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WEBHOOK_KEY}"
    }

    stages {
        stage('Checkout Code') {
            steps {
                script {
                    def gitRef = ''
                    def refDesc = ''

                    if (params.TAG?.trim()) {
                        gitRef = "refs/tags/${params.TAG}"
                        refDesc = "TAG: ${params.TAG}"
                    } else {
                        gitRef = "**/${params.BRANCH.replaceAll('origin/', '')}"
                        refDesc = "BRANCH: ${params.BRANCH}"
                    }

                    echo "Checkout ${SERVICE_NAME} -> ${refDesc}"
                    env.ACTUAL_BUILD_TARGET = refDesc

                    checkout([
                        $class: 'GitSCM',
                        branches: [[name: gitRef]],
                        userRemoteConfigs: [[
                            url: "http://gitlab.data-match.net:8929/it/dm-inspect.git",
                            credentialsId: '0c8fcb0a-8636-4f97-ae91-3dd2ed5b5212'
                        ]],
                        extensions: [
                            [$class: 'CleanBeforeCheckout']
                        ]
                    ])
                }
            }
        }

        stage('Generate Tag') {
            steps {
                script {
                    def gitHash = sh(returnStdout: true, script: "git rev-parse HEAD").trim().take(8)
                    def buildDate = sh(returnStdout: true, script: "date +%Y%m%d").trim()
                    env.FINAL_TAG = "${buildDate}-${gitHash}"
                    env.FULL_IMAGE_NAME = "${env.CURRENT_IMAGE_NAME_BASE}:${env.FINAL_TAG}"

                    def rawMsg = sh(returnStdout: true, script: "git log -1 --pretty=%s").trim()
                    env.GIT_COMMIT_MSG = rawMsg.replace('"', '\\"')

                    echo "------------------------------------------------"
                    echo "镜像 Tag: ${env.FINAL_TAG}"
                    echo "提交信息: ${env.GIT_COMMIT_MSG}"
                    echo "------------------------------------------------"
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    // Dockerfile 位于项目根目录
                    def servicePath = "."
                    buildDockerImage(
                        servicePath,
                        env.FULL_IMAGE_NAME,
                        env.CURRENT_IMAGE_NAME_BASE
                    )
                }
            }
        }

        stage('Push Docker Image') {
            steps {
                script {
                    pushDockerImage(
                        env.FULL_IMAGE_NAME,
                        env.CURRENT_IMAGE_NAME_BASE
                    )
                }
            }
        }
    }

    post {
        success {
            script {
                notifySuccess()
            }
        }

        failure {
            script {
                notifyFailure()
            }
        }

        aborted {
            script {
                notifyWeChat("⚠️", "构建被中止")
            }
        }

        always {
            script {
                if (env.FULL_IMAGE_NAME) {
                    sh "docker rmi ${env.FULL_IMAGE_NAME} || echo '清理失败: \$?'"
                }
                if (env.CURRENT_IMAGE_NAME_BASE) {
                    sh "docker rmi ${env.CURRENT_IMAGE_NAME_BASE}:latest || echo '清理失败: \$?'"
                }
            }
        }
    }
}

/**
 * 构建 Docker 镜像
 */
def buildDockerImage(String servicePath, String fullImageName, String imageBase) {
    dir(servicePath) {
        sh '''
            echo "=== Docker Build Start ==="
        '''
        sh "docker build -t ${fullImageName} ."
        sh "docker tag ${fullImageName} ${imageBase}:latest"
        sh "docker images | head"
        echo "=== Docker Build End ==="
    }
}

/**
 * 推送 Docker 镜像
 */
def pushDockerImage(String fullImageName, String imageBase) {
    withDockerRegistry(
        credentialsId: env.DOCKER_REGISTRY_CREDENTIALS_ID,
        url: env.DOCKER_REGISTRY_URL
    ) {
        sh "docker push ${fullImageName}"
        sh "docker push ${imageBase}:latest"
    }
}

/**
 * 企业微信文本通知 (强制在 Master 节点执行)
 */
import groovy.json.JsonOutput

def notifyWeChat(String statusEmoji, String statusText) {
    node('master') {
        def content = """# ${statusEmoji} ${statusText}

**项目名称：** ${env.JOB_BASE_NAME}
**服务名称：** ${env.SERVICE_NAME}
**仓库地址：** ${env.GIT_URL}
**代码分支：** ${env.ACTUAL_BUILD_TARGET}
**镜像Tag：** ${env.FINAL_TAG}
**镜像名称：** ${env.FULL_IMAGE_NAME}

> **最后提交信息：**
> ${env.GIT_COMMIT_MSG ?: 'N/A'}
**[查看 Jenkins Job](${env.BUILD_URL})**"""

        def payload = [
            msgtype : "markdown",
            markdown: [
                content: content
            ]
        ]

        writeFile(
            file: 'wechat_notification.json',
            text: JsonOutput.toJson(payload)
        )

        sh """
        curl -s --fail --retry 3 --retry-delay 2 --max-time 10 \\
          -X POST "${env.WEBHOOK_URL}" \\
          -H 'Content-Type: application/json' \\
          -d @wechat_notification.json \\
          || echo "⚠️ 企业微信通知发送失败"
        """
    }
}

def notifySuccess() {
    notifyWeChat("✅", "镜像构建并发布成功")
}

def notifyFailure() {
    notifyWeChat("❌", "构建或发布失败，请查看 Jenkins 日志")
}
