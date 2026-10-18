#define _GNU_SOURCE
#include <unistd.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
int main(void) {
  char self[PATH_MAX], node[PATH_MAX], script[PATH_MAX];
  ssize_t n=readlink("/proc/self/exe",self,sizeof(self)-1);
  if(n<0||n>=(ssize_t)sizeof(self)-1)return 1;
  self[n]=0; char *name=strrchr(self,'/'); if(!name)return 1;
  const char *role=strstr(name,"Far")?"far":"near"; *name=0;
  if(snprintf(node,sizeof(node),"%s/runtime/node",self)>=(int)sizeof(node)||snprintf(script,sizeof(script),"%s/src/desktop/bootstrap.cjs",self)>=(int)sizeof(script))return 1;
  char *args[]={node,script,"--role",(char*)role,NULL};
  execv(node,args);perror("SSH Relay startup failed");return 1;
}
